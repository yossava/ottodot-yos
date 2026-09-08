import { copyFileSync, constants } from "node:fs";

try {
  copyFileSync(".env.example", ".env", constants.COPYFILE_EXCL);
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}
