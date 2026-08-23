import { env } from "./config/env";
import { server } from "./api/server";

server.listen(env.PORT, () => {
  console.log(
    `RazorRecovery backend server running on http://localhost:${env.PORT} (CORS_ORIGIN=${env.CORS_ORIGIN})`,
  );
});
