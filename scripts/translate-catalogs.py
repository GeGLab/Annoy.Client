"""Explicit development import: sends only the public pt-BR UI catalog for translation.
Never run in the application; all resulting catalogs ship locally. Requires --public-ui-only.
"""
import concurrent.futures, json, pathlib, re, sys, time, urllib.parse, urllib.request
if '--public-ui-only' not in sys.argv:
    raise SystemExit('Explicit --public-ui-only is required')
directory = pathlib.Path('src/shared/localization/catalogs')
source = json.loads((directory / 'pt-BR.json').read_text(encoding='utf8'))
brands = sorted(['Annoy.Server','Annoy','annoy-server','annoy','Discord','Steam','Spotify','WhatsApp','Telegram','TeamSpeak','GIPHY','OpenMoji','YouTube','LinkedIn','GitHub','Instagram','Facebook','Matrix','Slack','Element','Apple Music','VS Code','IntelliJ','DBeaver','SQL Server'],key=len,reverse=True)
def protect(value):
    value=value.replace('{count}','{p999}')
    for i,brand in enumerate(brands): value=value.replace(brand,'{p%d}'%(900+i))
    return value
def restore(value):
    value=value.replace('{p999}','{count}')
    for i,brand in enumerate(brands): value=value.replace('{p%d}'%(900+i),brand)
    return value
def translate(language):
    target = 'zh-CN' if language == 'zh-Hans' else language
    file = directory / (language + '.json')
    saved = json.loads(file.read_text(encoding='utf8')) if file.exists() else {}
    pending = [(key, value) for key, value in source.items() if key not in saved or any(brand in value and brand not in saved[key] for brand in brands)]
    batches = [[]]
    size = 0
    for entry in pending:
        if size + len(entry[1]) > 2800:
            batches.append([]); size = 0
        batches[-1].append(entry); size += len(entry[1]) + 20
    for batch in batches:
        if not batch: continue
        query = '\n'.join('\u00a7%04d\u00a7\n%s' % (i, protect(value)) for i, (_, value) in enumerate(batch))
        url = 'https://translate.googleapis.com/translate_a/single?' + urllib.parse.urlencode({'client':'gtx','sl':'pt','tl':target,'dt':'t','q':query})
        for attempt in range(4):
            try:
                request = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'})
                with urllib.request.urlopen(request, timeout=40) as response:
                    data = json.load(response)
                translated = ''.join(item[0] for item in data[0] if item[0])
                pieces = re.split(r'\u00a7\s*(\d{4})\s*\u00a7', translated)
                result = {int(pieces[i]):pieces[i+1].strip() for i in range(1,len(pieces),2)}
                if len(result) != len(batch): raise ValueError('Missing translation markers')
                for i,(key,value) in enumerate(batch):
                    text = result[i]
                    text = restore(re.sub(r'\{\s*p\s*(\d+)\s*\}',r'{p\1}',text))
                    if sorted(re.findall(r'\{\w+\}',text)) != sorted(re.findall(r'\{\w+\}',value)):
                        raise ValueError('Placeholder mismatch: ' + key)
                    saved[key] = (' ' if value.startswith(' ') else '') + text.strip() + (' ' if value.endswith(' ') else '')
                file.write_text(json.dumps({key:saved[key] for key in source if key in saved},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
                print(language, len(saved), '/', len(source), flush=True)
                time.sleep(.4)
                break
            except Exception as error:
                if attempt == 3: raise
                print(language, 'retry', str(error)[:140], flush=True); time.sleep(2*(attempt+1))
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    list(pool.map(translate, ['en','es','fr','it','ja','zh-Hans']))
