"""Genera assets/icons/icon{16,32,48,128}.png: círculo verde, círculo blanco interior y un check verde.
El de 128 deja el dibujo en 96x96 con 16 px de margen transparente, como pide la Chrome Web Store.
Sin dependencias: escribe PNG con zlib. Uso: python3 scripts/make_icons.py"""
import struct, zlib, math, os

GREEN = (29, 185, 84)    # verde de la app #1db954
WHITE = (255, 255, 255)

def seg_dist(px, py, ax, ay, bx, by):
    """Distancia del punto al segmento AB."""
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

# Check en coordenadas normalizadas [-1, 1], trazo con puntas redondeadas
CHECK = [(-0.36, 0.02), (-0.1, 0.28), (0.38, -0.22)]

PADDING = {128: 16}  # margen transparente por tamaño (px)

def pixel(x, y, size):
    pad = PADDING.get(size, 0)
    art = size - 2 * pad
    u = ((x - pad) / art) * 2 - 1
    v = ((y - pad) / art) * 2 - 1
    r = math.hypot(u, v)
    if r > 0.96:
        return None
    if r > 0.7:                  # anillo verde exterior
        return GREEN
    # trazo más grueso en tamaños chicos para que se lea
    width = 0.13 if size >= 48 else 0.17
    d = min(seg_dist(u, v, *CHECK[0], *CHECK[1]), seg_dist(u, v, *CHECK[1], *CHECK[2]))
    return GREEN if d < width else WHITE

def render(size, ss=4):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    c = pixel(x + (sx + 0.5) / ss, y + (sy + 0.5) / ss, size)
                    if c:
                        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 1
            n = acc[3]
            if n:
                row += bytes([acc[0] // n, acc[1] // n, acc[2] // n, round(255 * n / (ss * ss))])
            else:
                row += bytes([0, 0, 0, 0])
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

out = os.path.join(os.path.dirname(__file__), '..', 'assets', 'icons')
for s in (16, 32, 48, 128):
    with open(os.path.join(out, f'icon{s}.png'), 'wb') as f:
        f.write(render(s))
print('ok')
