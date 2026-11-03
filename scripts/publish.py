"""Publish the aggregate-only site to an explicitly requested new GitHub repository."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
FILES=['docs','scripts','tests','.gitignore','README.md','package.json','package-lock.json','playwright.config.js']


def run(args,check=True):
    return subprocess.run(args,cwd=ROOT,text=True,capture_output=True,check=check)


def public_check():
    for p in (ROOT/'docs').rglob('*'):
        if not p.is_file():continue
        text=p.read_text()
        for marker in ('sk-or-', 'api_key_file', '/home/exouser/', 'native_request', 'BEGIN PRIVATE KEY'):
            if marker in text:raise RuntimeError('Private material in public site: '+str(p.relative_to(ROOT)))
    data=json.loads((ROOT/'docs/assets/data.json').read_text())
    assert len(data['models'])==4 and len(data['routing']['means'])==4


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--create',action='store_true');parser.add_argument('--refresh',action='store_true')
    args=parser.parse_args()
    if args.refresh:
        python=ROOT.parent/'router_baselines/KNN/.venv/bin/python'
        result=run([str(python) if python.exists() else sys.executable,str(ROOT/'scripts/export_data.py')])
        print(result.stdout,end='')
    public_check()
    local=ROOT/'deployment.local.json'
    if args.create:
        user=json.loads(run(['gh','api','user']).stdout)
        run(['gh','auth','setup-git','--hostname','github.com'])
        name='benchmark-router-dashboard';owner=user['login'];repo=owner+'/'+name
        if not (ROOT/'.git').exists():
            run(['git','init','-b','main'])
            run(['git','config','user.name',owner])
            run(['git','config','user.email',f"{user['id']}+{owner}@users.noreply.github.com"])
        run(['git','add','--',*FILES])
        if run(['git','diff','--cached','--quiet'],check=False).returncode:
            run(['git','commit','-m','Add benchmark models and routing dashboard'])
        # An existing remote must be this repository; never force-push or overwrite it.
        remote=run(['git','remote','get-url','origin'],check=False)
        if remote.returncode:
            exists=run(['gh','repo','view',repo,'--json','nameWithOwner'],check=False)
            if exists.returncode==0:
                raise RuntimeError('Repository already exists; inspect it before attaching this checkout')
            print(run(['gh','repo','create',repo,'--public','--source',str(ROOT),'--remote','origin',
                       '--description','Model and routing experiment dashboard: accuracy, costs, tokens, Perf/Cost and F1', '--push']).stdout)
        elif remote.stdout.strip() not in (f'https://github.com/{repo}.git',f'git@github.com:{repo}.git'):
            raise RuntimeError('Unexpected origin repository')
        else:
            run(['git','push','origin','main'])
        pages=run(['gh','api',f'repos/{repo}/pages'],check=False)
        if pages.returncode:
            run(['gh','api',f'repos/{repo}/pages','-X','POST','-f','source[branch]=main','-f','source[path]=/docs'])
        page=json.loads(run(['gh','api',f'repos/{repo}/pages']).stdout)
        local.write_text(json.dumps({'repository':repo,'url':page['html_url'],'created':time.time()},indent=2)+'\n')
        run(['gh','repo','edit',repo,'--homepage',page['html_url']])
        print(json.dumps({'repository':repo,'url':page['html_url'],'status':'PUBLISHED_SOURCE'}))
    else:
        config=json.loads(local.read_text())
        remote=run(['git','remote','get-url','origin']).stdout.strip()
        if config['repository'] not in remote:raise RuntimeError('Unexpected origin')
        run(['git','add','--','docs/assets/data.json','docs/assets/models.csv','docs/assets/routers.csv'])
        if run(['git','diff','--cached','--quiet'],check=False).returncode:
            run(['git','commit','-m','Refresh benchmark statistics'])
        # Also retries a previous commit whose push was interrupted.
        run(['git','push','origin','main'])
        print(json.dumps({'status':'SYNCED','url':config['url']}))


if __name__=='__main__':main()
