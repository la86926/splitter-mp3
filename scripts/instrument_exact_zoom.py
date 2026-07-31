from pathlib import Path
import re

APP = Path('splitter-app.html')
INDEX = Path('index.html')

text = APP.read_text(encoding='utf-8')

if 'waveBox.dataset.viewA=viewA.toFixed(6)' not in text:
    pattern = re.compile(
        r'(function setPreciseView\(start,span\)\{[\s\S]*?viewA=start;\s*viewB=start\+span;)(\s*scheduleWave\(\);)',
        re.M,
    )
    text, count = pattern.subn(
        r'\1\n    waveBox.dataset.viewA=viewA.toFixed(6);\n    waveBox.dataset.viewB=viewB.toFixed(6);\2',
        text,
        count=1,
    )
    if count != 1:
        raise RuntimeError('No se encontró setPreciseView')

marker = 'if(!pointerPinchActive||waveTouchPointers.size<2)return;'
if 'waveBox.dataset.pinchMoves' not in text:
    if marker not in text:
        raise RuntimeError('No se encontró el movimiento del pellizco')
    text = text.replace(
        marker,
        marker + '\n    waveBox.dataset.pinchMoves=String((Number(waveBox.dataset.pinchMoves)||0)+1);',
        1,
    )

# Solo existen dos liberaciones antiguas sin protección: una en las asas y otra
# en el marco naranja. No aplicamos una sustitución global para evitar alterar
# cualquier otra expresión JavaScript.
unsafe = '        el.releasePointerCapture(e.pointerId);'
safe = '        try{el.releasePointerCapture(e.pointerId)}catch(_){}'
occurrences = text.count(unsafe)
if occurrences not in (0, 2):
    raise RuntimeError(f'Número inesperado de liberaciones antiguas: {occurrences}')
if occurrences == 2:
    text = text.replace(unsafe, safe, 2)

APP.write_text(text, encoding='utf-8')

index = INDEX.read_text(encoding='utf-8')
index = re.sub(r'20260731-native\d+', '20260731-native17', index)
INDEX.write_text(index, encoding='utf-8')
