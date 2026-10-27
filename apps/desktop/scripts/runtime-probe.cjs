const { app } = require("electron");

app.whenReady().then(() => {
  let sqlite;
  try {
    const database = require("node:sqlite");
    const connection = new database.DatabaseSync(":memory:");
    connection.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY)");
    connection.close();
    sqlite = "available";
  } catch (error) {
    sqlite = `unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }

  console.log(
    JSON.stringify({
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      sqlite,
    }),
  );
  app.quit();
});
