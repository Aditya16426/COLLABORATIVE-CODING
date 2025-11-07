export default {
  server: {
    proxy: {
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true,
      },
      "/create-room": "http://localhost:3000",
    },
    allowedHosts: [
      "undelightfully-hydrodynamic-jena.ngrok-free.dev", // ✅ your ngrok domain
    ],
  },
};
