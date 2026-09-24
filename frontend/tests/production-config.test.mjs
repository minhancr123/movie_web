import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('Production Next.js config validation', async () => {
    // Read the file content
    const configPath = path.join(process.cwd(), 'next.config.js');
    if (!fs.existsSync(configPath)) {
        const fallbackPath = path.join(process.cwd(), 'next.config.mjs');
        if (fs.existsSync(fallbackPath)) {
            const content = fs.readFileSync(fallbackPath, 'utf-8');
            assert.ok(!content.includes('ignoreDuringBuilds: true'), 'eslint ignoreDuringBuilds must not be true');
            assert.ok(!content.includes('ignoreBuildErrors: true'), 'typescript ignoreBuildErrors must not be true');
            return;
        }
        assert.fail('next.config.js or next.config.mjs not found');
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    assert.ok(!content.includes('ignoreDuringBuilds: true'), 'eslint ignoreDuringBuilds must not be true');
    assert.ok(!content.includes('ignoreBuildErrors: true'), 'typescript ignoreBuildErrors must not be true');
});
