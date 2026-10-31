#!/bin/sh
# Builds a self-contained single-file version at dist/game.html (for hosting as one page).
set -e
cd "$(dirname "$0")"
mkdir -p dist
npx --yes esbuild@0.21.5 main.js --bundle --minify --format=iife --alias:three=./lib/three.module.js --outfile=dist/bundle.js
python3 - <<'PY'
import base64,re
h=open('index.html').read()
h=re.sub(r'<script type="importmap">.*?</script>\n','',h)
b=open('dist/bundle.js').read().replace('</script','<\\/script')
g=base64.b64encode(open('assets/player.glb','rb').read()).decode()
w=base64.b64encode(open('assets/wumpa.png','rb').read()).decode()
k=base64.b64encode(open('assets/aku_aku.glb','rb').read()).decode()
import json
tex=json.dumps({n:base64.b64encode(open(f'assets/{n}.png','rb').read()).decode() for n in ['crate','crate_life','crate_checkpoint','crate_tnt','aku_crate']})
h=h.replace('<script type="module" src="./main.js"></script>',
 '<script>window.__PLAYER_B64="'+g+'";window.__WUMPA_B64="'+w+'";window.__AKU_B64="'+k+'";window.__TEX_B64='+tex+'</script>\n<script>'+b+'</script>')
open('dist/game.html','w').write(h)
# fragment (no doctype/html/head/body) for hosts that supply their own page skeleton
style=re.search(r'<style>.*?</style>',h,re.S).group(0)
body=re.search(r'<body>(.*)</body>',h,re.S).group(1)
open('dist/artifact.html','w').write('<title>Crash Bandicoot Adventure</title>\n'+style+'\n'+body)
PY
