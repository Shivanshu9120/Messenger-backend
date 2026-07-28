const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  receiver: { type: String, default: null }, // For 1-on-1 chats
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null }, // For group chats
  content: { type: String, default: '' },
  mediaUrl: { type: String, default: null },
  mediaType: { type: String, default: null }, // 'image' or 'file'
  reactions: [
    {
      user: { type: String },
      emoji: { type: String }
    }
  ],
  deletedForEveryone: { type: Boolean, default: false },
  deletedFor: [{ type: String }], // Array of usernames who deleted this message for themselves
  deleted: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now },
  readBy: [{ type: String }], // Array of usernames who have opened/read this message
  read: { type: Boolean, default: false } // General read flag
});

module.exports = mongoose.model('Message', messageSchema);