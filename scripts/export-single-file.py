from pathlib import Path
import base64
import re


def make_inline_script_ready(doc: str) -> str:
    """
    把内联的 <script type="module"> 降级成普通 <script>，并挪到 </body> 之前。

    原因：WorkBuddy 的 HTML 产物预览面板不执行 module 脚本，页面会白屏；普通脚本则可以执行。
    降级后要注意普通脚本是同步执行的——留在 <head> 里会在 #root 出现之前就跑，
    所以必须挪到 body 末尾（module 默认 defer 才没有这个问题）。
    """
    i = doc.find('<script type="module">')
    if i < 0:
        return doc
    j = doc.find('</script>', i)
    if j < 0:
        return doc
    j += len('</script>')
    block = doc[i:j].replace('<script type="module">', '<script>', 1)
    rest = doc[:i] + doc[j:]
    if '</body>' not in rest:
        return rest + block
    return rest.replace('</body>', block + '\n</body>', 1)


root = Path(__file__).resolve().parents[1]
client = root / 'dist/client'
html = (client / 'index.html').read_text(encoding='utf-8')

for match in list(re.finditer(r'<script[^>]+src="([^"]+)"[^>]*></script>', html)):
    js = (client / match[1].lstrip('/')).read_text(encoding='utf-8')
    for asset in ('mascot.svg', 'profile.svg', 'model.svg'):
        data = base64.b64encode((root / 'public/assets' / asset).read_bytes()).decode()
        js = js.replace('/assets/' + asset, 'data:image/svg+xml;base64,' + data)
    html = html.replace(match[0], '<script type="module">' + js.replace('</script', '<\\/script') + '</script>')

for match in list(re.finditer(r'<link[^>]+href="([^"]+\.css)"[^>]*>', html)):
    css = (client / match[1].lstrip('/')).read_text(encoding='utf-8')
    html = html.replace(match[0], '<style>' + css + '</style>')

html = make_inline_script_ready(html)

for output in (root / 'standalone.html', root.parent / 'mushsci-Coze主工作区融合原型.html'):
    output.write_text(html, encoding='utf-8')
    print(f'{output} ({output.stat().st_size:,} bytes)')
