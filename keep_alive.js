import http from 'http';

function keep_alive() {
  const server = http.createServer(function(req, res) {
    res.write("I'm alive");
    res.end();
  })

  server.listen(8080);
}

export default keep_alive;  // Export the server
