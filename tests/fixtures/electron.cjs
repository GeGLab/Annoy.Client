const { app } = require("electron");
app.setPath("userData", process.env.DISTOPIC_TEST_DATA);
void import("../../out/main/index.js");
