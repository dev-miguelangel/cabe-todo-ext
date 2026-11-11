"""Genera assets/icons/icon{16,32,48,128}.png: círculo mitad sol (mañana) / mitad noche (tarde).
Sin dependencias: escribe PNG con zlib. Uso: python3 scripts/make_icons.py"""
import struct, zlib, math, os

SUN = (29, 185, 84)      # mañana: Mountain Meadow #1db954
NIGHT = (32, 33, 36)     # tarde: gris oscuro de Chrome #202124
LINE = (177, 242, 177)   # Madang #b1f2b1

def pixel(x, y, size):
    # coordenadas normalizadas en [-1, 1]
    u = (x / size) * 2 - 1
    v = (y / size) * 2 - 1
    r = math.hypot(u, v)
    if r > 0.92:
        return None
    if abs(u) < 0.06:            # línea divisoria AM | PM
        return LINE
    if u < 0:
        return SUN
    # luna creciente sobre la mitad derecha
    if math.hypot(u - 0.52, v + 0.18) < 0.26 and math.hypot(u - 0.62, v + 0.26) > 0.22:
        return LINE
    return NIGHT

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
