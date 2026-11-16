// Singleton through the module cache: this file runs once, so there is exactly one Logger.
class Logger {
  constructor() {
    this.lines = [];
  }

  log(message) {
    this.lines.push(message);
  }
}

module.exports = new Logger();
