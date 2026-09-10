import { spawn } from "node:child_process";

const ROBLOX_URL =
  /^roblox:\/\/placeId=\d+&gameInstanceId=[a-zA-Z0-9-]{1,100}$/;

export async function launchRoblox(
  url,
  { platform = process.platform, spawnFn = spawn, onError = () => {} } = {},
) {
  if (!ROBLOX_URL.test(url)) throw new Error("Invalid Roblox join URL");
  if (platform !== "win32") {
    onError(new Error("Automatic joining is currently supported on Windows."));
    return false;
  }
  try {
    const child = spawnFn(
      "rundll32.exe",
      ["url.dll,FileProtocolHandler", url],
      {
        windowsHide: true,
        stdio: "ignore",
      },
    );
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (result, error) => {
        if (settled) return;
        settled = true;
        if (error) onError(error);
        resolve(result);
      };
      child.once("error", (error) => finish(false, error));
      child.once("exit", (code) =>
        finish(
          code === 0,
          code === 0
            ? null
            : new Error(`Windows protocol dispatcher exited with ${code}.`),
        ),
      );
    });
  } catch (error) {
    onError(error);
    return false;
  }
}
