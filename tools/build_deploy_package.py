import hashlib
import os
import zipfile
from pathlib import Path

def build_package(repo_root, output_dir, release_id):
    repo_root = Path(repo_root)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    zip_path = output_dir / f"cineon-deploy-{release_id}.zip"
    
    whitelist = [
        "docker-compose.prod.yml",
        "deploy/caddy/Caddyfile",
        "deploy/backup.sh",
        "deploy/restore-drill.sh",
        ".env.prod.example",
        "docs/cineon-deployment/CINEON_DEPLOY_A_Z.md",
        "docs/cineon-deployment/OPERATIONS.md",
        "docs/cineon-deployment/ACCEPTANCE.md",
        "docs/cineon-deployment/PACKAGE_README.txt",
    ]
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for item in whitelist:
            item_path = repo_root / item
            if item_path.exists():
                z.write(item_path, arcname=item)
                
    return zip_path

def verify_package(zip_path, expected):
    with zipfile.ZipFile(zip_path) as z:
        if z.testzip() is not None:
            raise ValueError('corrupt zip')
            
        names = z.namelist()
        if len(names) != len(set(names)):
            raise ValueError('duplicate entry rejected')
            
        if set(names) != set(expected.keys()):
            raise ValueError('unexpected entries')
            
        main_doc_found = False
        
        for name in names:
            filename = Path(name).name
            if filename.startswith('.env') and not filename.endswith('.example'):
                raise ValueError('secret entry rejected')
                
            if '..' in name or name.startswith('/') or name.startswith('\\') or os.path.isabs(name):
                raise ValueError('path traversal rejected')
                
            if name == 'docs/cineon-deployment/CINEON_DEPLOY_A_Z.md':
                main_doc_found = True
                
            content = z.read(name)
            if hashlib.sha256(content).hexdigest() != expected[name]:
                raise ValueError('checksum mismatch')
                
        if not main_doc_found:
            raise ValueError('missing main document rejected')
