# Messenger - Backend Server

The backend server for the Messenger app. Built with Node.js, Express, Socket.io, and MongoDB (Mongoose). It handles user authentication, REST APIs, database persistence, and WebSocket real-time messaging events.

## Features

- **Authentication API**: User registration, login, JWT issuance, and password hashing with `bcryptjs`.
- **Socket.io Real-Time Server**: Event-driven communication for live messages, typing indicators, and user online/offline status.
- **MongoDB Schemas**:
  - `User`: User profile, credentials, and online status tracking.
  - `Message`: Chat history, 1-on-1 and group message records, timestamps, and attachments.
  - `Group`: Group room metadata, admin tracking, and member lists.
- **File Uploads**: API handling for media attachments sent in chats.
- **CORS Configured**: Configurable origins for local and deployed frontend setups.

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ORM
- **WebSockets**: Socket.io
- **Auth & Security**: JSON Web Tokens (JWT), bcryptjs, CORS
- **Environment**: dotenv

## Project Structure

```
Backend/Messenger-backend/
├── models/         # Mongoose models (User, Message, Group)
├── routes/         # Express API routes (authRoutes, etc.)
├── server.js       # Entry point & Socket.io handlers
├── .env.example    # Environment variable template
└── package.json    # Project dependencies and scripts
```

## Environment Setup

Create a `.env` file in `Backend/Messenger-backend/`:

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret_key
CLIENT_URL=http://localhost:5173
```

## Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   # Development (Node)
   npm run dev

   # Production
   npm start
   ```

   The server will start on `http://localhost:5000`.

## Socket.io Events

| Event | Direction | Description |
| --- | --- | --- |
| `connection` | Server | Triggered when client connects |
| `user_online` | Both | Registers user online status |
| `join_room` | Client -> Server | Joins a chat room (direct or group) |
| `send_message` | Client -> Server | Sends a message payload to a room |
| `receive_message` | Server -> Client | Relays message to room participants |
| `typing` | Client -> Server | Broadcasts typing status to room |
| `stop_typing` | Client -> Server | Broadcasts stopped typing status |
| `disconnect` | Server | Cleans up socket connection |

## Future Enhancements

- WebRTC signaling server for audio/video calling
- Redis Pub/Sub adapter for scaling Socket.io across multiple instances
- Push notifications integration (FCM / Web Push)
- Message expiration / TTL auto-deletion
- E2EE key exchange endpoints

## Contributing

1. Fork the repo.
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Commit your changes: `git commit -m "Add feature"`
4. Push to the branch: `git push origin feature/your-feature-name`
5. Submit a Pull Request.

## License

[MIT](LICENSE)
