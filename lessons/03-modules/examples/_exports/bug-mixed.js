// Mixing both styles: the line order decides what survives.
exports.first = 1;               // goes on the OLD object
module.exports = { second: 2 };  // module.exports now points to a NEW object
exports.third = 3;               // goes on the OLD object again (lost)
