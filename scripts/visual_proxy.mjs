// Local TCP relay inside the disposable test container; only the host's test ports.
import net from 'node:net';
for (const port of [18500,18501]) {
 net.createServer(socket=>{const target=net.connect({host:'host.docker.internal',port});socket.pipe(target);target.pipe(socket);socket.on('error',()=>target.destroy());target.on('error',()=>socket.destroy());}).listen(port,'127.0.0.1');
}
