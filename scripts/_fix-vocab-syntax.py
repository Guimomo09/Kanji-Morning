import re

data = open('scripts/generate-vocab-reels.mjs', 'rb').read()

# Fix lines where string value is missing closing quote before comma
# Matches: ':   'value,  →  ':   'value',
fixed = re.sub(rb"(:\s+'[^'\r\n]+)(,)", rb"\1'\2", data)

open('scripts/generate-vocab-reels.mjs', 'wb').write(fixed)
print('Done')
