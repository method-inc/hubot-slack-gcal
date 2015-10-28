var fs = require('fs');
var Path = require('path');

module.exports = function(robot) {
  var path = Path.resolve(__dirname, 'scripts');
  if (fs.existsSync(path)) {
    fs.readdirSync(path).forEach(function(file) {
      robot.loadFile(path, file);
    });
  }
};
