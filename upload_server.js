'use strict';
// Import Admin SDK
var admin = require("firebase-admin");
const serviceAccount = require("./path/to/serviceAccountKey.json");

const express = require('express');
const line = require('@line/bot-sdk');
const PORT = process.env.PORT || 3000;
const Obniz = require('obniz');
var obniz = new Obniz("[OBNIZ-ID]");
var userServiceUUID = "[ServiceUUID]"; // ServiceUUID
var psdiServiceUUID = "E625601E-9E55-4597-A598-76018A0D293D";
var psdiCharacteristicUUID = "26E2B12B-85F0-4F3F-9FDD-91D114270E6E";
var notifyCharacteristicUUID = "62FBD229-6EDD-4D1A-B554-5C4E1BB29169";
var writeCharacteristicUUID = "E9062E71-9E62-4BC6-B0D3-35CDCD9B027B";
var customDeviceName = "LINE Things Starter Obniz"

var strValue

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "[FIREBASE-DATABASE-URL]"
});

var db = admin.database();
var ref = db.ref("table1"); //count要素への参照

const config = {
    channelSecret: '[ChannelSecret]',
    channelAccessToken: '[ChannelAccessToken]'
};

const app = express();
var iCount = 0;
var iStandTime = 0;
var iWeight = 0;
var iJumpCount = 0;
var iPrevJumpCount =0


obniz.onconnect = async function () {


  obniz.ble.security.setAuth(['bonding']);
  obniz.ble.security.setModeLevel(1, 2);

  obniz.ble.security.onerror = function() {
    console.error('security set params error');
    obniz.reboot();
  };

  var enc = new TextEncoder();
  var psdiCharacteristic = new obniz.ble.characteristic({
    "uuid" : psdiCharacteristicUUID,
    "properties" : ["read"],
    "text" : "9999"
  });

  var notifyCharacteristic = new obniz.ble.characteristic({
    "uuid" : notifyCharacteristicUUID,
    "properties" : ["notify"],
    "data" : [0x00],
    "descriptors" : [{
      "uuid" : "2902",
      "data" : [0x00, 0x00]
    }]
  });

  var writeCharacteristic = new obniz.ble.characteristic({
    "uuid" : writeCharacteristicUUID,
    "properties" : ["write"],
    "data" : [0x00]
  });

  var psdiService = new obniz.ble.service({
    "uuid" : psdiServiceUUID,
    "characteristics" : [psdiCharacteristic]
  });
  obniz.ble.peripheral.addService(psdiService);

  var userService = new obniz.ble.service({
    "uuid" : userServiceUUID,
    "characteristics" : [notifyCharacteristic, writeCharacteristic]
  });
  obniz.ble.peripheral.addService(userService); 

  obniz.ble.advertisement.setAdvData(userService.advData);
  obniz.ble.advertisement.setScanRespData({
    localName : customDeviceName
  });
  obniz.ble.advertisement.start();

  writeCharacteristic.onwritefromremote = function(address, newvalue) {
    if (newvalue[0] <= 1 ) {
      obniz.display.clear();
      newvalue[0]==1 ? obniz.display.print("ON") : obniz.display.print("OFF");
    }
    //console.log("remote address :", address);
    //console.log("remote data :", newvalue);
  }

  obniz.switch.onchange = async function(state) {
    if (state === "push") {
      await notifyCharacteristic.writeWait([1]);
      notifyCharacteristic.notify();
    } else if (state === "none") {
      await notifyCharacteristic.writeWait([0]);
      notifyCharacteristic.notify();
    }
  }

    obniz.display.clear();
    //ロードセル
    const hcsr04 = obniz.wired("hx711" , {gnd:0, dout:1, sck:2, vcc:3} );
    //０調整
    hcsr04.zeroAdjust();

    var iloopCount=0;

    while(true) {
      
      //ロードセルごとに調整
      //何も負荷かけていない状態でなるべく0になるように値を調整していく
      hcsr04.offset = 88000;
      hcsr04.scale = 88925;

      const val = await hcsr04.getValueWait(1);

      //地球の重力に魂を引かれたら1回カウントして、BLEを送る
      if (Math.abs(iWeight - Math.round(val * 1000) / 1000)  >= 0.004){
        iJumpCount+=1;

        console.log("前回"+ Math.round(iWeight * 1000) / 1000 + "今回" + Math.round(val * 1000) / 1000 + "差" + Math.abs((Math.round(val * 1000) / 1000 - iWeight)));

        //BLE送る
        await notifyCharacteristic.writeWait([1]);
        notifyCharacteristic.notify();
        await notifyCharacteristic.writeWait([0]);
        notifyCharacteristic.notify();

      }else{

        console.log("前回"+ Math.round(iWeight * 1000) / 1000 + "今回" + Math.round(val * 1000) / 1000 );
      };

      iWeight=val;
      

      strValue=Math.abs(roundFloat(val, 4 )*10);
      obniz.display.clear();
      obniz.display.print(strValue);
      ref.update({"weight": strValue + "g" });

      var strWeight
      if (strValue >= 1) {
        iCount+=0.258;
        iStandTime=0;
        ref.update({"Sittingtime": iCount + "秒" });
      }else{
        ref.update({"Sittingtime": "0秒" });
        iCount=0;
        iStandTime+=0.258;
}


    let advDataFromService = userService.advData;
    advDataFromService.localName = 'obniz';
    obniz.ble.advertisement.setAdvData(advDataFromService);

    obniz.ble.advertisement.setScanRespData({
    localName: 'LINE Things Trial obniz',
    });

      await obniz.wait(100);
    }
    function roundFloat( number, n ) {
      var _pow = Math.pow( 10 , n );
      return Math.round( number * _pow ) / _pow;
    }
    

    
  
    }

app.get('/', (req, res) => res.send('Hello LINE BOT!(GET)')); //ブラウザ確認用(無くても問題ない)
app.post('/webhook', line.middleware(config), (req, res) => {
    console.log(req.body.events);


    Promise
      .all(req.body.events.map(handleEvent))
      .then((result) => res.json(result));
});

const client = new line.Client(config);

function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text' ) {
    return Promise.resolve(null);
  }
  
  //LIFFのURLをMessagingAPIで送る
  var strMessage="お疲れ様です！次のトレーニングも頑張って！" + "line://app/1598775653-Nwaobw5B" ;
  return client.replyMessage(event.replyToken, [{type: "text", text: strMessage}]);

}

app.listen(PORT);
console.log(`Server running at ${PORT}`);


//(process.env.NOW_REGION) ? module.exports = app : app.listen(PORT);
//console.log(`Server running at ${PORT}`);