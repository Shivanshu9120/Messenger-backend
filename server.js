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

const io = new Server(server, {
  cors: { origin: 'http://localhost:5173', methods: ['GET', 'POST'], credentials: true }
});

app.use(cors({ origin: 'http://localhost:5173', methods: ['GET', 'POST'] }));
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

app.use('/api/auth', authRoutes);
app.get('/', (req, res) => res.send('Chat app backend running'));

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // User login event: sets user online status and sends initial data
  socket.on('userLogin', async (username) => {
    await User.updateOne({ username }, { online: true });
    const users = await User.find({}, 'username online'); // Fetch all users
    const groups = await Group.find({ members: username }, 'name members'); // Fetch only groups where user is a member
    io.emit('updateUsers', users); // Broadcast updated user list
    socket.emit('updateGroups', groups); // Send groups specific to this user
    socket.username = username;
  });

  // Create group event: saves new group to DB
  socket.on('createGroup', async ({ groupName, members }) => {
    const group = new Group({ name: groupName, members });
    await group.save();
    // Notify only group members of the new group
    members.forEach(member => io.to(member).emit('updateGroups', [group]));
  });

  socket.on('joinChat', (chatId) => socket.join(chatId));

  socket.on('sendMessage', async (data) => {
    const { sender, receiver, groupId, content } = data;
    const message = new Message({ sender, receiver, groupId, content });
    await message.save();
    if (groupId) {
      const group = await Group.findById(groupId);
      group.members.forEach(member => io.to(member).emit('receiveMessage', message));
    } else if (receiver) {
      io.to(sender).to(receiver).emit('receiveMessage', message);
    } else {
      io.emit('receiveMessage', message);
    }
  });

  socket.on('markAsRead', async ({ messageId, chatId }) => {
    await Message.updateOne({ _id: messageId }, { read: true });
    io.to(chatId).emit('messageRead', messageId);
  });

  socket.on('fetchMessages', async ({ chatId, type }, callback) => {
    let messages;
    if (type === 'public') messages = await Message.find({ receiver: null, groupId: null });
    else if (type === 'group') messages = await Message.find({ groupId: chatId });
    else {
      messages = await Message.find({
        $or: [
          { sender: socket.username, receiver: chatId.split('-').find(u => u !== socket.username) },
          { sender: chatId.split('-').find(u => u !== socket.username), receiver: socket.username }
        ]
      });
    }
    callback(messages);
  });

  socket.on('disconnect', async () => {
    if (socket.username) {
      await User.updateOne({ username: socket.username }, { online: false });
      const users = await User.find({}, 'username online');
      io.emit('updateUsers', users);
    }
    console.log('A user disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));