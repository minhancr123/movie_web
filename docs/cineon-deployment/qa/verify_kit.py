from pathlib import Path
import http.server, json, re, socket, subprocess, threading, time, urllib.request, urllib.error, os

ROOT = Path(__file__).resolve().parent.parent
KIT = ROOT/'kit'
QA = ROOT/'qa'
records=[]
def record(s):
    records.append(s); print(s, flush=True)
def run(args, **kw):
    p=subprocess.run(args, capture_output=True, text=True, encoding='utf-8', errors='replace', **kw)
    if p.returncode: raise RuntimeError(f'{args}\n{p.stdout}\n{p.stderr}')
    return p.stdout

cfg = json.loads(run(['docker','compose','--env-file',str(KIT/'env.cineon.example'),
                     '--env-file',str(KIT/'release.env.example'),'-f',str(KIT/'compose.cineon.yml'),
                     'config','--format','json']))
services=cfg['services']
assert set(services)=={'redis','backend-node','frontend','backend-node-worker','backend-node-scheduler'}
for name in ['frontend','backend-node']:
    assert all(p['host_ip']=='127.0.0.1' for p in services[name]['ports'])
assert 'ports' not in services['redis']
assert services['redis']['command'][-1]=='noeviction'
assert services['backend-node']['environment']['VIDEO_TRANSCODE_FALLBACK']=='never'
assert services['backend-node']['environment']['REMUX_MAX_WRITERS']=='1'
for name in ['backend-node-worker','backend-node-scheduler']:
    assert services[name]['image']==services['backend-node']['image']
    assert services[name]['healthcheck']['disable'] is True
assert sum(int(s['mem_limit']) for s in services.values())==3008*1024*1024
record('PASS compose syntax and semantic assertions')

caddy=os.environ.get('CADDY_BIN')
if caddy:
    run([caddy,'validate','--config',str(KIT/'Caddyfile')])
    record('CADDY '+run([caddy,'version']).strip())
else:
    run(['docker','run','--rm','--network','none','--mount',f'type=bind,source={KIT},target=/kit,readonly',
         'caddy:2','caddy','validate','--config','/kit/Caddyfile'])
record('PASS original Caddyfile validation')

bash=r'C:\Program Files\Git\bin\bash.exe'
md=(ROOT/'CINEON_DEPLOY_A_Z.md').read_text(encoding='utf-8')
count=0
for lang, block in re.findall(r'```([^\n]*)\n(.*?)\n```',md,re.S):
    if lang=='bash':
        f=QA/f'bash-{count:02d}.sh'; f.write_text(block+'\n',encoding='utf-8',newline='\n')
        run([bash,'-n',str(f)]); count+=1
run([bash,'-n',str(KIT/'smoke.sh')])
record(f'PASS syntax of {count} Bash command blocks and smoke.sh')

def start_mock(label):
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body=label.encode()
            status=401 if label=='backend' and self.path=='/api/auth/me' else 200
            self.send_response(status); self.send_header('Content-Type','text/plain')
            self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
        def log_message(self,*args): pass
    server=http.server.ThreadingHTTPServer(('127.0.0.1' if caddy else '0.0.0.0',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    return server

backend, frontend = start_mock('backend'), start_mock('frontend')
container='cineon-doc-routing-qa'
test_cfg=(KIT/'Caddyfile').read_text(encoding='utf-8').split('cineon.me {',2)[-1]
# Split on exact standalone line, not the www suffix.
test_cfg=':8080 {\n'+(KIT/'Caddyfile').read_text(encoding='utf-8').split('\ncineon.me {',1)[1]
upstream_host='127.0.0.1' if caddy else 'host.docker.internal'
test_cfg=test_cfg.replace('127.0.0.1:5001',f'{upstream_host}:{backend.server_port}')
test_cfg=test_cfg.replace('127.0.0.1:3000',f'{upstream_host}:{frontend.server_port}')
if caddy:
    with socket.socket() as s:
        s.bind(('127.0.0.1',0)); port=s.getsockname()[1]
    test_cfg='{\n admin off\n auto_https off\n persist_config off\n}\n'+test_cfg.replace(':8080 {',f'http://127.0.0.1:{port} {{',1)
(QA/'Caddyfile.test').write_text(test_cfg,encoding='utf-8',newline='\n')
tests={
 '/':'frontend', '/auth/login':'frontend', '/api/auth/providers':'frontend',
 '/api/auth/session':'frontend','/api/auth/csrf':'frontend','/api/auth/callback/google':'frontend',
 '/api/auth/callback/credentials':'frontend','/api/auth/signout':'frontend',
 '/api/auth/register':'backend','/api/auth/login':'backend','/api/auth/login/':'backend',
 '/api/auth/google-login':'backend','/api/auth/me':'backend','/api/auth/profile':'backend',
 '/api/catalog/home':'backend','/api/playback/hls/test':'backend','/socket.io/':'backend','/health':'backend',
}
process=None
try:
    if caddy:
        process=subprocess.Popen([caddy,'run','--config',str(QA/'Caddyfile.test')],
                                 stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                                 creationflags=subprocess.CREATE_NO_WINDOW)
    else:
        run(['docker','run','-d','--name',container,'-p','127.0.0.1::8080',
             '--mount',f'type=bind,source={QA},target=/qa,readonly',
             'caddy:2','caddy','run','--config','/qa/Caddyfile.test'])
        port=run(['docker','port',container,'8080/tcp']).strip().rsplit(':',1)[1]
    base=f'http://127.0.0.1:{port}'
    def get(path):
        try:
            with urllib.request.urlopen(base+path,timeout=8) as r: return r.status,r.read().decode()
        except urllib.error.HTTPError as e: return e.code,e.read().decode()
    for _ in range(30):
        try:
            if get('/')[1]=='frontend': break
        except (OSError,urllib.error.URLError): pass
        time.sleep(.2)
    for path, expected in tests.items():
        status,body=get(path)
        assert body==expected,(path,status,body,expected)
    assert get('/api/local-playback-diagnostic')[0]==404
    assert get('/api/local-playback-diagnostic/anything')[0]==404
    smoke=run([bash,str(KIT/'smoke.sh'),base])
    record(f'PASS Caddy HTTP routing: {len(tests)+2} requests using two mock upstreams')
    record(smoke.strip())
finally:
    if process:
        process.terminate(); process.wait(timeout=10)
    else:
        subprocess.run(['docker','rm','-f',container],capture_output=True)
    backend.shutdown(); frontend.shutdown()

record('NOT RUN: application npm tests, Docker application build, production DNS/TLS, VPS load test or database changes')
(QA/'VERIFICATION.txt').write_text('\n'.join(records)+'\n',encoding='utf-8')
