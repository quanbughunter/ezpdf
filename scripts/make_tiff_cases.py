#!/usr/bin/env python3
"""
tests/fixtures/tiff/: TIFF layouts that real files use and Pillow's own
writer does not make, written with tifffile, each with the picture it should
decode to (<name>.png), for tests/word-probe.ts:

  tiles with the horizontal predictor (LZW, Deflate; 8-bit RGB, 16-bit
  grey, big-endian), uncompressed tiles, a 4-bit grey, 4-bit and 1-bit
  palettes, 16-bit RGB (big-endian, with the predictor), RGBA with plain
  alpha, CMYK 16-bit, grey with alpha, and samples in separate planes (not
  decoded: ezPDF shows a chip, its test expects null).
Usage: python3 scripts/make_tiff_cases.py   (needs tifffile, numpy, Pillow)
"""
import os

import numpy as np
import tifffile
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tests', 'fixtures', 'tiff')
os.makedirs(OUT, exist_ok=True)

rng = np.random.default_rng(7)
H, W = 90, 120
yy, xx = np.mgrid[0:H, 0:W]


def rgb8():
    a = np.zeros((H, W, 3), np.uint8)
    a[..., 0] = (xx * 255 // (W - 1)).astype(np.uint8)
    a[..., 1] = (yy * 255 // (H - 1)).astype(np.uint8)
    a[..., 2] = ((xx + yy) % 64 * 4).astype(np.uint8)
    a[30:50, 20:100] = rng.integers(0, 256, (20, 80, 3), dtype=np.uint8)  # noise: many LZW codes
    return a


def grey16():
    return ((xx * 65535 // (W - 1)) ^ (yy * 37)).astype(np.uint16)


def save(name, data, ref, **kw):
    tifffile.imwrite(os.path.join(OUT, name + '.tif'), data, **kw)
    if ref is not None:
        Image.fromarray(ref).save(os.path.join(OUT, name + '.png'))


rgb = rgb8()
save('tile-lzw-pred-rgb', rgb, rgb, tile=(64, 64), compression='lzw', predictor=True, photometric='rgb')
save('tile-zip-pred-rgb', rgb, rgb, tile=(32, 48), compression='zlib', predictor=True, photometric='rgb')
save('tile-raw-rgb', rgb, rgb, tile=(64, 64), photometric='rgb')
g16 = grey16()
save('tile-zip-pred-grey16-be', g16, (g16 >> 8).astype(np.uint8), tile=(64, 64), compression='zlib', predictor=True, byteorder='>', photometric='minisblack')
save('strip-pred-rgb16-be', np.dstack([g16, g16[::-1], g16[:, ::-1]]), np.dstack([(g16 >> 8), (g16[::-1] >> 8), (g16[:, ::-1] >> 8)]).astype(np.uint8), compression='lzw', predictor=True, byteorder='>', photometric='rgb', rowsperstrip=16)
g4 = (xx // 13 % 16).astype(np.uint8)
save('grey4', g4, (g4 * 17).astype(np.uint8), bitspersample=4, photometric='minisblack')
# tifffile writes a 256-entry colour map whatever the bits (the reader takes the map's own length)
pal = np.zeros((3, 256), np.uint16)
for i in range(16):
    pal[:, i] = [i * 4369, (15 - i) * 4369, (i * 7 % 16) * 4369]
p4 = ((xx // 13 + yy // 10) % 16).astype(np.uint8)
save('palette4', p4, np.dstack([(pal[c][p4] >> 8).astype(np.uint8) for c in range(3)]), bitspersample=4, photometric='palette', colormap=pal)
pal1 = np.zeros((3, 256), np.uint16)
pal1[:, :2] = [[0, 65535], [0, 52428], [65535, 0]]
p1 = ((xx // 7 + yy // 7) % 2).astype(np.uint8)
save('palette1', p1, np.dstack([(pal1[c][p1] >> 8).astype(np.uint8) for c in range(3)]), bitspersample=1, photometric='palette', colormap=pal1)
rgba = np.dstack([rgb, (xx * 255 // (W - 1)).astype(np.uint8)])
save('rgba-plain-alpha', rgba, rgba, photometric='rgb', extrasamples=['unassalpha'], compression='lzw')
cmyk = np.dstack([g16, g16[::-1], g16[:, ::-1], (g16 // 4)]).astype(np.uint16)
c8 = (cmyk >> 8).astype(np.float64)
k = (255 - c8[..., 3]) / 255
ref = np.dstack([np.round((255 - c8[..., i]) * k) for i in range(3)]).astype(np.uint8)
save('cmyk16', cmyk, ref, photometric='separated', compression='zlib')
ga = np.dstack([(yy * 255 // (H - 1)).astype(np.uint8), (xx * 255 // (W - 1)).astype(np.uint8)])
gaRef = np.dstack([ga[..., 0], ga[..., 0], ga[..., 0], ga[..., 1]])
save('grey-alpha', ga, gaRef, photometric='minisblack', extrasamples=['unassalpha'])
save('planar', np.moveaxis(rgb, -1, 0), None, photometric='rgb', planarconfig='separate')
print('wrote', len(os.listdir(OUT)), 'files in', OUT)
