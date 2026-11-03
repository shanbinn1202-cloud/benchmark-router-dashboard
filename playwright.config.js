const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests', testMatch: '**/*.spec.js', timeout: 30000, workers: 1,
  use: {baseURL:'http://127.0.0.1:8767', screenshot:'only-on-failure'},
  webServer: {command:'python3 -m http.server 8767 --bind 127.0.0.1 --directory docs',url:'http://127.0.0.1:8767',reuseExistingServer:true},
  projects: [{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}]
});
