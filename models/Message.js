const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  receiver: { type: String, default: null }, // For 1-on-1 chats
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null }, // For group chats
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false } // Read receipt status
});

module.exports = mongoose.model('Message', messageSchema);