const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  online: { type: Boolean, default: false },
  statusMessage: { type: String, default: 'Hey there! I am using Messenger.' },
  avatarColor: { type: String, default: '#00a884' },
  blockedUsers: [{ type: String }] // Array of usernames blocked by this user
});

module.exports = mongoose.model('User', userSchema);