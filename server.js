require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const authRoutes = require('./routes/authRoutes');
const User = require('./models/User');
const Message = require('./models/Message');
const Group = require('./models/Group');

const app = express();
const server = http.createServer(app);

const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(url => url.trim())
  : '*';

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], credentials: true }
});

app.use(cors({ origin: allowedOrigins, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], credentials: true }));
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected');
    // Reset all users to offline on server startup to prevent stale online statuses
    await User.updateMany({}, { online: false });
  })
  .catch(err => console.log(err));

app.use('/api/auth', authRoutes);
app.get('/', (req, res) => res.send('Chat app backend running'));

async function getLastMessagesForUser(username) {
  try {
    const lastMessages = {};
    const unreadCounts = {};

    const msgs = await Message.find({
      $or: [{ sender: username }, { receiver: username }],
      deletedFor: { $ne: username }
    }).sort({ timestamp: 1 });

    msgs.forEach((m) => {
      const partner = m.sender === username ? m.receiver : m.sender;
      if (partner) {
        lastMessages[partner] = m;
        lastMessages[`${username}-${partner}`] = m;
        lastMessages[`${partner}-${username}`] = m;

        if (m.receiver === username && (!m.readBy || !m.readBy.includes(username))) {
          unreadCounts[partner] = (unreadCounts[partner] || 0) + 1;
        }
      }
    });

    const groups = await Group.find({ members: username });
    for (const g of groups) {
      const lastGrpMsg = await Message.findOne({ groupId: g._id, deletedFor: { $ne: username } }).sort({ timestamp: -1 });
      if (lastGrpMsg) {
        lastMessages[g._id.toString()] = lastGrpMsg;
      }
      const unreadGroupMsgsCount = await Message.countDocuments({
        groupId: g._id,
        sender: { $ne: username },
        readBy: { $ne: username },
        deletedFor: { $ne: username }
      });
      if (unreadGroupMsgsCount > 0) {
        unreadCounts[g._id.toString()] = unreadGroupMsgsCount;
      }
    }

    return { lastMessages, unreadCounts };
  } catch (err) {
    console.error('Error getting last messages:', err);
    return { lastMessages: {}, unreadCounts: {} };
  }
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // User login event: sets user online status and joins personal socket room
  socket.on('userLogin', async (username) => {
    if (!username) return;
    socket.username = username;
    socket.join(username);

    await User.updateOne({ username }, { online: true });
    const users = await User.find({}, 'username online statusMessage avatarColor');
    const groups = await Group.find({ members: username }, 'name members');
    const { lastMessages, unreadCounts } = await getLastMessagesForUser(username);
    const currentUserObj = await User.findOne({ username });

    io.emit('updateUsers', users);
    socket.emit('updateGroups', groups);
    socket.emit('updateLastMessages', { lastMessages, unreadCounts });
    socket.emit('updateBlockedUsers', currentUserObj?.blockedUsers || []);
  });

  // Block contact handler
  socket.on('blockUser', async ({ username, targetUsername }) => {
    if (!username || !targetUsername) return;
    const user = await User.findOneAndUpdate(
      { username },
      { $addToSet: { blockedUsers: targetUsername } },
      { new: true }
    );
    socket.emit('updateBlockedUsers', user?.blockedUsers || []);
  });

  // Unblock contact handler
  socket.on('unblockUser', async ({ username, targetUsername }) => {
    if (!username || !targetUsername) return;
    const user = await User.findOneAndUpdate(
      { username },
      { $pull: { blockedUsers: targetUsername } },
      { new: true }
    );
    socket.emit('updateBlockedUsers', user?.blockedUsers || []);
  });

  // Create group event: saves new group to DB
  socket.on('createGroup', async ({ groupName, members }) => {
    try {
      const group = new Group({ name: groupName, members });
      await group.save();

      // Notify all members of the new group
      members.forEach((member) => {
        io.to(member).emit('updateGroups', [group]);
      });
    } catch (err) {
      console.error('Error creating group:', err);
    }
  });

  socket.on('joinChat', (chatId) => {
    socket.join(chatId);
  });

  // Send Message with optional media attachment & block enforcement
  socket.on('sendMessage', async (data) => {
    const { sender, receiver, groupId, content, mediaUrl, mediaType } = data;

    if (receiver) {
      const receiverUser = await User.findOne({ username: receiver });
      const senderUser = await User.findOne({ username: sender });
      if (receiverUser?.blockedUsers?.includes(sender) || senderUser?.blockedUsers?.includes(receiver)) {
        // Do not deliver message if either user has blocked the other
        return;
      }
    }

    const message = new Message({
      sender,
      receiver,
      groupId,
      content: content || '',
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || null,
      readBy: [sender],
    });

    await message.save();

    if (groupId) {
      const group = await Group.findById(groupId);
      if (group) {
        group.members.forEach((member) => {
          io.to(member).emit('receiveMessage', message);
        });
      }
    } else if (receiver) {
      io.to(sender).to(receiver).emit('receiveMessage', message);
    } else {
      io.emit('receiveMessage', message);
    }
  });

  // Real-time Typing Indicators
  socket.on('typing', ({ chatId, chatType, username }) => {
    if (chatType === 'group') {
      socket.broadcast.emit('userTyping', { chatId, username });
    } else {
      const otherUser = chatId.split('-').find((u) => u !== username);
      if (otherUser) {
        io.to(otherUser).emit('userTyping', { chatId, username });
      }
    }
  });

  socket.on('stopTyping', ({ chatId, chatType, username }) => {
    if (chatType === 'group') {
      socket.broadcast.emit('userStopTyping', { chatId, username });
    } else {
      const otherUser = chatId.split('-').find((u) => u !== username);
      if (otherUser) {
        io.to(otherUser).emit('userStopTyping', { chatId, username });
      }
    }
  });

  // Mark unread messages in conversation as read by this user
  socket.on('markAsRead', async ({ chatId, chatType, username }) => {
    if (!username) return;
    if (chatType === 'group') {
      await Message.updateMany(
        { groupId: chatId, sender: { $ne: username } },
        { $addToSet: { readBy: username }, read: true }
      );
      io.to(chatId).emit('messagesRead', { chatId, reader: username });
    } else if (chatType === 'private') {
      const otherUser = chatId.split('-').find((u) => u !== username);
      if (otherUser) {
        await Message.updateMany(
          { sender: otherUser, receiver: username },
          { $addToSet: { readBy: username }, read: true }
        );
        io.to(otherUser).to(username).emit('messagesRead', { chatId, reader: username });
      }
    }
  });

  // React to a message
  socket.on('reactMessage', async ({ messageId, emoji, username, chatId }) => {
    const msg = await Message.findById(messageId);
    if (msg) {
      const existingIndex = msg.reactions.findIndex((r) => r.user === username);
      if (existingIndex > -1) {
        if (msg.reactions[existingIndex].emoji === emoji) {
          msg.reactions.splice(existingIndex, 1); // toggle off
        } else {
          msg.reactions[existingIndex].emoji = emoji;
        }
      } else {
        msg.reactions.push({ user: username, emoji });
      }
      await msg.save();
      io.emit('messageReacted', { messageId, reactions: msg.reactions, chatId });
    }
  });

  // Delete message for EVERYONE (Global Soft Delete)
  socket.on('deleteForEveryone', async ({ messageId, chatId, username }) => {
    try {
      console.log('deleteForEveryone requested:', { messageId, chatId, username });
      if (!messageId) return;

      const msg = await Message.findById(messageId);
      if (msg && msg.sender === username) {
        msg.deletedForEveryone = true;
        msg.deleted = true;
        msg.content = 'This message was deleted';
        msg.mediaUrl = null;
        msg.mediaType = null;
        msg.reactions = [];
        await msg.save();

        // Get latest remaining message for last message preview
        let lastMsg = null;
        if (msg.groupId) {
          lastMsg = await Message.findOne({ groupId: msg.groupId, deletedFor: { $ne: username } }).sort({ timestamp: -1 });
        } else if (chatId) {
          const parts = chatId.split('-');
          lastMsg = await Message.findOne({
            $or: [
              { sender: parts[0], receiver: parts[1] },
              { sender: parts[1], receiver: parts[0] }
            ],
            deletedFor: { $ne: username }
          }).sort({ timestamp: -1 });
        }

        io.emit('messageDeletedForEveryone', { messageId: String(messageId), chatId, updatedLastMessage: lastMsg });
      }
    } catch (err) {
      console.error('Error in deleteForEveryone:', err);
    }
  });

  // Delete message for ME (Local Soft Delete)
  socket.on('deleteForMe', async ({ messageId, chatId, username }) => {
    try {
      console.log('deleteForMe requested:', { messageId, chatId, username });
      if (!messageId) return;

      await Message.updateOne({ _id: messageId }, { $addToSet: { deletedFor: username } });

      // Get latest remaining message for username
      let lastMsg = null;
      if (chatId && chatId.includes('-')) {
        const parts = chatId.split('-');
        lastMsg = await Message.findOne({
          $or: [
            { sender: parts[0], receiver: parts[1] },
            { sender: parts[1], receiver: parts[0] }
          ],
          deletedFor: { $ne: username }
        }).sort({ timestamp: -1 });
      } else if (chatId) {
        lastMsg = await Message.findOne({ groupId: chatId, deletedFor: { $ne: username } }).sort({ timestamp: -1 });
      }

      socket.emit('messageDeletedForMe', { messageId: String(messageId), chatId, updatedLastMessage: lastMsg });
      if (username) {
        io.to(username).emit('messageDeletedForMe', { messageId: String(messageId), chatId, updatedLastMessage: lastMsg });
      }
    } catch (err) {
      console.error('Error in deleteForMe:', err);
    }
  });

  // Fetch conversation messages
  socket.on('fetchMessages', async ({ chatId, type }, callback) => {
    try {
      const currentUser = socket.username;
      let messages = [];
      if (type === 'public') {
        messages = await Message.find({ receiver: null, groupId: null, deletedFor: { $ne: currentUser } }).sort({ timestamp: 1 });
      } else if (type === 'group') {
        messages = await Message.find({ groupId: chatId, deletedFor: { $ne: currentUser } }).sort({ timestamp: 1 });
      } else if (chatId) {
        const parts = chatId.split('-');
        const userA = parts[0];
        const userB = parts[1] || parts[0];
        messages = await Message.find({
          $or: [
            { sender: userA, receiver: userB },
            { sender: userB, receiver: userA }
          ],
          deletedFor: { $ne: currentUser }
        }).sort({ timestamp: 1 });
      }
      if (typeof callback === 'function') callback(messages);
    } catch (err) {
      console.error('Error fetching messages:', err);
      if (typeof callback === 'function') callback([]);
    }
  });

  socket.on('updateStatus', async ({ username, statusMessage }) => {
    if (username) {
      await User.updateOne({ username }, { statusMessage });
      const users = await User.find({}, 'username online statusMessage avatarColor');
      io.emit('updateUsers', users);
    }
  });

  socket.on('userLogout', async (username) => {
    if (username) {
      await User.updateOne({ username }, { online: false });
      const users = await User.find({}, 'username online statusMessage avatarColor');
      io.emit('updateUsers', users);
    }
  });

  socket.on('disconnect', async () => {
    if (socket.username) {
      await User.updateOne({ username: socket.username }, { online: false });
      const users = await User.find({}, 'username online statusMessage avatarColor');
      io.emit('updateUsers', users);
    }
    console.log('A user disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));