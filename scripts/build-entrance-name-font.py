"""Build the entrance-name WOFF2 subset from an official Source Han Serif SC Heavy OTF.

Requires fonttools[woff]. Usage: python scripts/build-entrance-name-font.py /path/to/font.otf
The full upstream font is a build input only, not a runtime asset.
"""
import re
import sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
profiles = (root / 'client/src/lib/cardEntranceProfiles.ts').read_text()
characters = ''.join(re.findall(r"name: '([^']+)'", profiles)) + ' '
font = TTFont(sys.argv[1])
missing = set(map(ord, characters)) - set(font.getBestCmap())
if missing:
    raise ValueError(f'Missing characters: {missing}')
options = subset.Options()
options.name_IDs = ['*']
builder = subset.Subsetter(options=options)
builder.populate(text=characters)
builder.subset(font)
# Rename the modified subset; keep upstream copyright and license metadata.
names = {1: 'Loveca Entrance', 4: 'Loveca Entrance Heavy',
         6: 'LovecaEntrance-Heavy', 16: 'Loveca Entrance', 17: 'Heavy',
         3: 'LovecaEntrance-Heavy-Subset-1'}
for record in font['name'].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
if 'CFF ' in font:
    cff = font['CFF '].cff
    cff.fontNames = ['LovecaEntrance-Heavy']
    cff.topDictIndex[0].FullName = 'Loveca Entrance Heavy'
    cff.topDictIndex[0].FamilyName = 'Loveca Entrance'
font.flavor = 'woff2'
output = root / 'client/src/components/game/card-entrance/fonts/entrance-names-heavy.woff2'
font.save(output)
print(f'{len(set(characters))} characters, {output.stat().st_size} bytes: {output}')
