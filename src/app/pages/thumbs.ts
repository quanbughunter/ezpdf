/**
 * The page organizer's sources and thumbnails. Every PDF the organizer
 * works with (the open document as it is now, files added to it, a scan)
 * is opened once in the PDFium worker for drawing; thumbnails are drawn
 * there without the page's own rotation, and the screen turns them.
 */
import { useEffect, useRef, useState } from 'react';
import { closeRenderSession, openRenderSession, renderPageImage } from '@/engine/export-client';
import type { PageInfo } from '@/engine/page-ops';

export interface SourceDoc {
  /** 0: the open document; 1…: added files, in order */
  src: number;
  name: string;
  bytes: ArrayBuffer;
  session: number;
  infos: PageInfo[];
}

export async function openSource(src: number, name: string, bytes: ArrayBuffer): Promise<SourceDoc> {
  const r = await openRenderSession(bytes.slice(0));
  return { src, name, bytes, session: r.session, infos: r.infos };
}

export function closeSource(s: SourceDoc) {
  void closeRenderSession(s.session);
}

/** Long side of a thumbnail in pixels (sharp at about 150 px on a 2× screen). */
const THUMB_PX = 320;

interface Job {
  key: string;
  session: number;
  page: number;
  dpi: number;
  waiters: ((url: string | null) => void)[];
}

/**
 * Draws thumbnails one at a time (the worker does one thing at a time
 * anyway), the latest asked first: what scrolled into view comes before
 * what scrolled past.
 */
export class ThumbQueue {
  private urls = new Map<string, string>();
  private jobs: Job[] = [];
  private running = false;
  /** bumped by dispose: a drawing that was under way then is thrown away */
  private gen = 0;

  get(key: string) {
    return this.urls.get(key) ?? null;
  }

  request(key: string, session: number, page: number, size: { w: number; h: number }): Promise<string | null> {
    const have = this.urls.get(key);
    if (have) return Promise.resolve(have);
    return new Promise((resolve) => {
      const job = this.jobs.find((j) => j.key === key);
      if (job) {
        job.waiters.push(resolve);
        // asked again: to the front
        this.jobs = [job, ...this.jobs.filter((j) => j !== job)];
      } else {
        const dpi = (THUMB_PX * 72) / Math.max(size.w, size.h, 1);
        this.jobs.unshift({ key, session, page, dpi, waiters: [resolve] });
      }
      void this.pump();
    });
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.jobs.length) {
        const job = this.jobs.shift()!;
        const gen = this.gen;
        let url: string | null = null;
        try {
          const r = await renderPageImage(job.session, job.page, job.dpi, true);
          if (gen !== this.gen) {
            for (const w of job.waiters) w(null);
            continue;
          }
          url = URL.createObjectURL(r.image);
          this.urls.set(job.key, url);
        } catch {
          url = null;
        }
        for (const w of job.waiters) w(url);
      }
    } finally {
      this.running = false;
    }
  }

  /** Drops every thumbnail and pending drawing (the queue can be used again). */
  dispose() {
    this.gen++;
    for (const j of this.jobs) for (const w of j.waiters) w(null);
    this.jobs = [];
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
  }
}

/** The thumbnail of a page once the element is near the screen. */
export function useThumb(queue: ThumbQueue, key: string, session: number | null, page: number, size: { w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(() => queue.get(key));
  useEffect(() => {
    if (session === null) return;
    const have = queue.get(key);
    if (have) return setUrl(have);
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void queue.request(key, session, page, size).then((u) => alive && setUrl(u));
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
    // size only matters for a new key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, key, session, page]);
  return { ref, url };
}
