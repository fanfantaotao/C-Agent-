import re,json,base64
from pathlib import Path
root=Path(__file__).resolve().parents[1]
source=(root.parent/'UI给的产品内设计参考.html').read_text(encoding='utf-8')
assets=root/'public'/'assets'
assets.mkdir(parents=True,exist_ok=True)
def asset(tag,name):
    uri=re.search(r'src="([^"]+)"',tag).group(1)
    mime,data=uri.split(',',1)
    ext='svg' if 'svg' in mime else 'png' if 'png' in mime else 'webp' if 'webp' in mime else 'jpg'
    (assets/f'{name}.{ext}').write_bytes(base64.b64decode(data))
    return f'/assets/{name}.{ext}'
hero=asset(re.search(r'<img class="hero-mascot"[^>]+>',source).group(0),'mascot')
avatar=asset(re.search(r'<div class="profile">\s*(<img[^>]+>)',source).group(1),'profile')
model=asset(re.search(r'<div class="model-pill">\s*(<img[^>]+>)',source).group(1),'model')
css=re.search(r'<style>([\s\S]*?)</style>',source).group(1)
(root/'src'/'reference.css').write_text(css,encoding='utf-8')
sidebar=re.search(r'<aside[\s\S]*?</aside>',source).group(0)
sidebar=re.sub(r'<img src="[^"]+"',f'<img src="{avatar}"',sidebar)
sidebar=re.sub(r'<div class="ctx-menu"[\s\S]*?</aside>','</aside>',sidebar)
(root/'src'/'reference.json').write_text(json.dumps(dict(hero=hero,avatar=avatar,model=model,sidebar=sidebar),ensure_ascii=False),encoding='utf-8')
messages=json.loads((root.parent/'coze-workspace-evidence'/'messages.json').read_text(encoding='utf-8'))
for m in messages:
    for k,v in m.items():
        if isinstance(v,str):
            v=v.replace('涛shen','LI').replace('扣子','mushsci')
            v=re.sub(r'C:\\Users\\Administrator\\Coze\\Drive\\多智能体协作测试\\','项目文件/',v)
            m[k]=v
(root/'src'/'messages.json').write_text(json.dumps(messages,ensure_ascii=False),encoding='utf-8')
print('Extracted original UI assets, style tokens, sidebar and 11 conversation messages.')
