import { execSync } from 'node:child_process';
import path from 'node:path';

export function verifyProject() {
    console.log('Verifying project...');
    const frontendDir = path.join(process.cwd(), 'frontend');
    execSync('npm run build', { cwd: frontendDir, stdio: 'inherit' });
    execSync('npm test', { cwd: frontendDir, stdio: 'inherit' });
    execSync('npm run typecheck', { cwd: frontendDir, stdio: 'inherit' });
    execSync('npm run lint', { cwd: frontendDir, stdio: 'inherit' });
    
    const backendDir = path.join(process.cwd(), 'backend-node');
    execSync('npm test', { cwd: backendDir, stdio: 'inherit' });
    console.log('Project verified successfully.');
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    verifyProject();
}
