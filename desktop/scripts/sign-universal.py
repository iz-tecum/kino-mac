#!/usr/bin/env python3
"""Locally sign and strictly verify a merged Mac app; never publish it."""
from pathlib import Path
import argparse,plistlib,subprocess,tempfile
p=argparse.ArgumentParser(description=__doc__);p.add_argument('app',type=Path);a=p.parse_args().app.resolve()
assert a.suffix=='.app' and (a/'Contents/Info.plist').is_file()
with tempfile.TemporaryDirectory(prefix='kino-sign-') as tmp:
 ent=Path(tmp)/'entitlements.plist'
 ent.write_bytes(plistlib.dumps({'com.apple.security.cs.allow-jit':True,'com.apple.security.cs.allow-unsigned-executable-memory':True}))
 for key in ['com.apple.FinderInfo','com.apple.ResourceFork']:
  subprocess.run(['/usr/bin/xattr','-dr',key,str(a)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False)
 subprocess.run(['/usr/bin/codesign','--force','--deep','--sign','-','--entitlements',str(ent),str(a)],check=True)
 subprocess.run(['/usr/bin/codesign','--verify','--deep','--strict',str(a)],check=True)
print('Local signature and strict verification passed:',a)
