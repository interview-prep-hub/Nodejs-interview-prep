// Stands in for a real database client. It cannot work in this demo.
module.exports = {
  async findUser() {
    throw new Error('no real database available');
  },
};
