data = open('scripts/generate-vocab-reels.mjs', 'rb').read()
lines = data.split(b'\n')
fixed = []
in_dict = False
count = 0
for line in lines:
    if b'WORD_DICT_FORM' in line:
        in_dict = True
    if in_dict and b'}' in line and b'{' not in line:
        in_dict = False
    if in_dict and b"':" in line:
        stripped = line.rstrip(b'\r')
        # Fix KEY missing closing quote: '...: or '...:  (no quote before colon)
        # Find the colon position — if before it there's no quote, fix it
        idx = stripped.find(b"':", 2)  # skip leading spaces
        if idx != -1 and stripped[idx+1:idx+2] != b"'":
            stripped = stripped[:idx] + b"':" + stripped[idx+2:]
            count += 1
        # Fix VALUE missing closing quote before comma
        if stripped.endswith(b',') and not stripped.endswith(b"',"):
            stripped = stripped[:-1] + b"',"
            count += 1
        line = stripped + b'\r'
    fixed.append(line)
result = b'\n'.join(fixed)
open('scripts/generate-vocab-reels.mjs', 'wb').write(result)
print(f'Fixed {count} occurrences')
