#!/usr/bin/env python3
"""Deploy the bot to the production SFTP server.

Usage (PowerShell):
    $env:SFTP_HOST='78.154.103.2'; $env:SFTP_PORT='2022'
    $env:SFTP_USER='bl_5630.d0752c29'; $env:SFTP_PASS='...'
    python deploy.py

Uploads all code files while skipping runtime data (daily stats, twitch
streamer list, caches, .env, node_modules, .git) so production state is
never overwritten. Also deletes files that no longer exist in this version.

Requires: pip install paramiko
"""

import os
import sys
import paramiko

ROOT = os.path.dirname(os.path.abspath(__file__))
SEP = os.sep

# Directories never uploaded
EXCLUDE_DIRS = {'node_modules', '.git', '__pycache__', '.cache'}
# Files never uploaded (secrets stay on the server)
EXCLUDE_FILES = {'.env'}
# Files deleted on the server (removed in this version)
DELETE_ON_SERVER = [
    '/src/commands/dailyStats.js',
    '/src/commands/evento.js',
    '/src/commands/eventconfig.js',
    '/src/commands/eventolimpar.js',
    '/src/commands/perfil.js',
    '/src/commands/server.js',
    '/src/lib/eventSignups.js',
    '/src/lib/externalSignupSync.js',
]


def skip(path):
    try:
        rel = os.path.relpath(path, ROOT).replace(SEP, '/')
    except ValueError:
        return True
    parts = rel.split('/')
    if parts[0] in EXCLUDE_DIRS:
        return True
    if '.cache/' in rel or rel == '.cache':
        return True
    if os.path.basename(path) in EXCLUDE_FILES:
        return True
    if rel.endswith('.zip') or rel.endswith('.log'):
        return True
    # Runtime data JSONs directly under src/data (keep images/ and rag/)
    if rel.startswith('src/data/') and rel.endswith('.json') and '/' not in rel[len('src/data/'):]:
        return True
    if rel.startswith(('data/cache/', 'data/logs/', 'data/events/')):
        return True
    return False


def load_dotenv(path):
    env = {}
    try:
        for line in open(path, encoding='utf-8'):
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, _, v = line.partition('=')
            env[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return env


def main():
    # .env is git-ignored; credentials can live there instead of shell env vars
    file_env = load_dotenv(os.path.join(ROOT, '.env'))

    def get(key, default=None):
        return os.environ.get(key) or file_env.get(key) or default

    host = get('SFTP_HOST', '78.154.103.2')
    port = int(get('SFTP_PORT', '2022'))
    user = get('SFTP_USER')
    password = get('SFTP_PASS')
    if not user or not password:
        sys.exit('Set SFTP_USER and SFTP_PASS in .env or as environment variables.')

    files = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if not skip(os.path.join(dirpath, d))]
        for f in filenames:
            p = os.path.join(dirpath, f)
            if not skip(p):
                files.append(p)
    print(f'{len(files)} files to upload')

    t = paramiko.Transport((host, port))
    t.connect(username=user, password=password)
    sftp = paramiko.SFTPClient.from_transport(t)

    def makedirs(remote):
        cur = ''
        for part in remote.strip('/').split('/')[:-1]:
            cur += '/' + part
            try:
                sftp.stat(cur)
            except IOError:
                sftp.mkdir(cur)

    for local in files:
        rel = os.path.relpath(local, ROOT).replace(SEP, '/')
        remote = '/' + rel
        makedirs(remote)
        sftp.put(local, remote)
    print(f'uploaded {len(files)}')

    for r in DELETE_ON_SERVER:
        try:
            sftp.remove(r)
            print('deleted', r)
        except IOError:
            print('skip delete', r)

    t.close()
    print('Done. Remember to restart the bot process on the server.')


if __name__ == '__main__':
    main()
