/**
 * Editing a Word body: what Enter, Shift+Enter, Backspace, Delete, the
 * bold/italic/underline buttons and "Xóa đoạn" do, and the guard that keeps
 * tables in shape. Shared by the editor (WordEditor.tsx) and the tests.
 */
import { chainCommands, deleteSelection, joinBackward, joinForward, selectNodeBackward, selectNodeForward, toggleMark } from 'prosemirror-commands';
import type { Node as PMNode, NodeType } from 'prosemirror-model';
import { NodeSelection, Plugin, Selection, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { schema } from './schema';
import type { WordModel } from './read';
import { paraInfo } from './read';
import { paraCss } from './styles';

const { paragraph, table, table_cell, locked, br } = schema.nodes;

/** Attributes of a paragraph made by Enter: the same look, a new paragraph in the file. */
function nextAttrs(model: WordModel, node: PMNode, atEnd: boolean) {
  if (atEnd && node.attrs.heading !== null) {
    // after a heading comes body text, as in Word
    return { css: model.defaultCss };
  }
  // the section break (if any) stays with the original paragraph (write.ts)
  return { ...node.attrs, ref: null, before: null, sect: false };
}

/**
 * Enter: split the paragraph, both parts keep its formatting (a list item
 * gives the next item). Enter in an empty list item ends the list there.
 */
export function splitParagraph(model: WordModel): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    if (state.selection instanceof NodeSelection) return false;
    if ($from.parent.type !== paragraph || !$from.sameParent($to)) {
      if (!dispatch) return true;
      const tr = state.tr.deleteSelection();
      dispatch(tr.scrollIntoView());
      return true;
    }
    const node = $from.parent;
    if (node.attrs.list && node.content.size === 0) {
      if (dispatch) {
        const info = paraInfo(model, node.attrs.ppr !== null ? (model.store[node.attrs.ppr] as Element) : null, true);
        dispatch(
          state.tr
            .setNodeMarkup($from.before(), undefined, { ...node.attrs, list: null, nolist: true, css: paraCss(info.props, info.markRun) })
            .scrollIntoView(),
        );
      }
      return true;
    }
    if (!dispatch) return true;
    const marks = state.storedMarks || ($to.parentOffset ? $from.marks() : null);
    let tr = state.tr;
    if (!state.selection.empty) tr = tr.deleteSelection();
    let pos = tr.mapping.map($from.pos);
    let $pos = tr.doc.resolve(pos);
    // only invisible items (a bookmark's end, a field's end) after the caret: this is the end of
    // the paragraph, and they stay with it; only invisible items before it: this is the start
    const hidden = (n: PMNode) => n.type === schema.nodes.inl && n.attrs.kind === 'hidden';
    if ($pos.textOffset === 0) {
      const kids: PMNode[] = [];
      $pos.parent.forEach((k) => kids.push(k));
      const i = $pos.index();
      if (i < kids.length && kids.slice(i).every(hidden)) pos = $pos.end();
      else if (i > 0 && kids.slice(0, i).every(hidden)) pos = $pos.start();
      $pos = tr.doc.resolve(pos);
    }
    const atEnd = $pos.parentOffset === $pos.parent.content.size;
    const head = $pos.parent;
    tr.split(pos, 1, [{ type: paragraph, attrs: nextAttrs(model, head, atEnd) }]);
    if (marks && !(atEnd && head.attrs.heading !== null)) tr.ensureMarks(marks);
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Shift+Enter: a line break inside the paragraph. */
export const lineBreak: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type !== paragraph) return false;
  if (dispatch) dispatch(state.tr.replaceSelectionWith(br.create(null, null, $from.marks())).scrollIntoView());
  return true;
};

export const toggleBold = toggleMark(schema.marks.b);
export const toggleItalic = toggleMark(schema.marks.i);
export const toggleUnderline = toggleMark(schema.marks.u);

/** Is the mark on for the selection (or for what the user types next)? */
export function markActive(state: EditorState, type: (typeof schema.marks)[keyof typeof schema.marks]) {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

/** the block (paragraph, table or read-only block) that contains `depth`-level position, at the top level of its container */
function blockRange(state: EditorState) {
  const { $from, $to } = state.selection;
  if (state.selection instanceof NodeSelection) {
    const n = state.selection.node;
    if (n.isBlock) return { from: state.selection.from, to: state.selection.to, container: $from.parent };
  }
  // walk up to the nearest container (doc or a table cell) shared by both ends
  let d = $from.sharedDepth($to.pos);
  // the two ends in different cells of one table: not a paragraph range (the table is not deleted)
  if (d > 0 && ($from.node(d).type === table || $from.node(d).type === schema.nodes.table_row)) return null;
  while (d > 0 && $from.node(d).type !== table_cell) d--;
  const container = $from.node(d);
  const from = $from.before(d + 1);
  const to = $to.after(d + 1);
  return { from, to, container };
}

/**
 * "Xóa đoạn": removes the paragraph(s) the selection touches (or the
 * selected read-only block). A table cell keeps at least an empty paragraph,
 * the document at least one.
 */
export function deleteParagraphs(model: WordModel): Command {
  return (state, dispatch) => {
    const r = blockRange(state);
    if (!r) return false;
    const tr = state.tr;
    const emptyPara = paragraph.create({ css: model.defaultCss });
    const containerStart = state.doc.resolve(r.from).start();
    const containerEnd = containerStart + r.container.content.size;
    if (r.from <= containerStart && r.to >= containerEnd) tr.replaceWith(r.from, r.to, emptyPara);
    else tr.delete(r.from, r.to);
    if (!dispatch) return true;
    const $pos = tr.doc.resolve(Math.min(tr.mapping.map(r.from), tr.doc.content.size));
    tr.setSelection(Selection.near($pos));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Backspace at the start of a paragraph that follows a table: Word does not
 * pull the text into the table; an empty paragraph is removed, otherwise
 * the cursor goes to the end of the table.
 */
const backAfterTable: Command = (state, dispatch) => {
  const { $cursor } = state.selection as TextSelection;
  if (!$cursor || $cursor.parentOffset > 0) return false;
  const index = $cursor.index($cursor.depth - 1);
  if (index === 0) return false;
  const before = $cursor.node($cursor.depth - 1).child(index - 1);
  if (before.type !== table) return false;
  if (dispatch) {
    const start = $cursor.before();
    let tr = state.tr;
    if ($cursor.parent.content.size === 0) tr = tr.delete(start, $cursor.after());
    tr.setSelection(Selection.near(tr.doc.resolve(start - 1), -1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Delete at the end of a paragraph before a table: into the table, nothing joined. */
const deleteBeforeTable: Command = (state, dispatch) => {
  const { $cursor } = state.selection as TextSelection;
  if (!$cursor || $cursor.parentOffset < $cursor.parent.content.size) return false;
  const parent = $cursor.node($cursor.depth - 1);
  const index = $cursor.index($cursor.depth - 1);
  if (index + 1 >= parent.childCount) return false;
  const after = parent.child(index + 1);
  if (after.type !== table) return false;
  if (dispatch) dispatch(state.tr.setSelection(Selection.near(state.doc.resolve($cursor.after() + 1))).scrollIntoView());
  return true;
};

/**
 * Backspace at the start of a paragraph that follows a read-only block (or
 * Delete at the end of one before it): the block is selected first; a second
 * press deletes it. ProseMirror's join would delete it at once.
 */
const selectLockedBefore: Command = (state, dispatch) => {
  const { $cursor } = state.selection as TextSelection;
  if (!$cursor || $cursor.parentOffset > 0) return false;
  const index = $cursor.index($cursor.depth - 1);
  if (index === 0) return false;
  const before = $cursor.node($cursor.depth - 1).child(index - 1);
  if (before.type !== locked) return false;
  if (dispatch) dispatch(state.tr.setSelection(NodeSelection.create(state.doc, $cursor.before() - before.nodeSize)).scrollIntoView());
  return true;
};
const selectLockedAfter: Command = (state, dispatch) => {
  const { $cursor } = state.selection as TextSelection;
  if (!$cursor || $cursor.parentOffset < $cursor.parent.content.size) return false;
  const parent = $cursor.node($cursor.depth - 1);
  const index = $cursor.index($cursor.depth - 1);
  if (index + 1 >= parent.childCount || parent.child(index + 1).type !== locked) return false;
  if (dispatch) dispatch(state.tr.setSelection(NodeSelection.create(state.doc, $cursor.after())).scrollIntoView());
  return true;
};

export const backspace = chainCommands(deleteSelection, backAfterTable, selectLockedBefore, joinBackward, selectNodeBackward);
export const del = chainCommands(deleteSelection, deleteBeforeTable, selectLockedAfter, joinForward, selectNodeForward);

/** each table's shape (rows × cells per row), in document order */
function shapes(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    if (n.type === table) {
      const rows: number[] = [];
      n.forEach((r) => rows.push(r.childCount));
      out.push(`${n.attrs.ref}:${rows.join(',')}`);
    }
    return true;
  });
  return out;
}

/**
 * Tables keep their shape: a change may remove a whole table (and Undo bring
 * it back), never add, split or reshape one (pasted tables arrive as
 * paragraphs, schema.ts). The tables of the document are always some of the
 * file's own tables, in their order and shape.
 */
export function tableGuard(model: WordModel) {
  const allowed = shapes(model.doc);
  return new Plugin({
    filterTransaction(tr: Transaction) {
      if (!tr.docChanged) return true;
      let i = 0;
      for (const s of shapes(tr.doc)) {
        while (i < allowed.length && allowed[i] !== s) i++;
        if (i === allowed.length) return false;
        i++;
      }
      return true;
    },
  });
}

const onLocked = (state: EditorState) => state.selection instanceof NodeSelection && state.selection.node.type === locked;

/**
 * A read-only block, once clicked, is selected as a whole; typing or
 * pasting must not replace it (deleting it stays possible: Backspace,
 * Delete or “Xóa đoạn”, on purpose).
 */
export const lockedGuard = new Plugin({
  props: {
    handleTextInput: (view) => onLocked(view.state),
    handlePaste: (view) => onLocked(view.state),
    handleDrop: (view) => onLocked(view.state),
  },
});

/** The node types a test may look for. */
export const types: Record<string, NodeType> = { paragraph, table, table_cell, locked, br };
