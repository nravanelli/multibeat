import { spawn } from 'node:child_process';
const p = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url) });
try {
  await new Promise((resolve,reject) => { p.stdout.once('data',resolve); p.once('error',reject); p.once('exit',code=>reject(new Error('Server exited '+code))); p.stderr.on('data',data=>process.stderr.write(data)); });
  for (const path of ['/', '/styles.css', '/hr-monitor.js', '/src/view.js', '/src/app.js', '/src/bluetooth.js', '/src/recorder.js', '/src/capture.js']) {
    const response = await fetch('http://localhost:5173'+path);
    if (response.status !== 200) throw new Error(path+' '+response.status);
    console.log(path, response.status, response.headers.get('content-type'));
  }
  const denied = await fetch('http://localhost:5173/package.json');
  if (denied.status !== 404) throw new Error('Unexpected non-asset access');
} finally { p.kill(); }
