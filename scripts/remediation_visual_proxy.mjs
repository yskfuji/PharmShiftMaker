// Relay only disposable audit endpoints, never the running user application.
import net from 'node:net';
for(const port of [18510,18511]){
 net.createServer(socket=>{
  const target=net.connect({host:'host.docker.internal',port});
  socket.pipe(target);target.pipe(socket);
  socket.on('error',()=>target.destroy());target.on('error',()=>socket.destroy());
 }).listen(port,'127.0.0.1');
}
