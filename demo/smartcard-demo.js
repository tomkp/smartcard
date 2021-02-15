'use strict';

const hexify = require('hexify');

const api = require('../lib/index');
const Devices = api.Devices;
const Iso7816Application = api.Iso7816Application;
const CommandApdu = api.CommandApdu;

const devices = new Devices();

devices.on('device-activated', (event) => {
  const currentDevices = event.devices;
  let device = event.device;
  console.log(`Device '${device}' activated, devices: ${currentDevices}`);
  currentDevices.map((device, index) => {
    console.log(`Device #${index + 1}: ${device.name}`);
  });

  device.on('card-inserted', (event) => {
    let card = event.card;
    console.log(`\nCard '${card.getAtr()}' inserted into '${event.device}'`);

    card.on('command-issued', (event) => {
      console.log(`Command '${event.command}' issued to '${event.card}' `);
    });

    card.on('response-received', (event) => {
      console.log(
        `Response '${event.response}' received from '${event.card}' in response to '${event.command}'`
      );
    });

    // card
    //     .issueCommand('00A404000E315041592E5359532E444446303100')
    //     .then((response) => {
    //         console.log(`Response '${response.toString('hex')}`);
    //     }).catch((error) => {
    //         console.error(error);
    //     });

    const application = new Iso7816Application(card);

    application.on('application-selected', (event) => {
      console.log(`Application Selected ${event.application}`);
    });

    application
      .selectFile([
        0x31,
        0x50,
        0x41,
        0x59,
        0x2e,
        0x53,
        0x59,
        0x53,
        0x2e,
        0x44,
        0x44,
        0x46,
        0x30,
        0x31,
      ])
      .then((response) => {
        console.info(
          `Select PSE Response: '${response}' '${response.meaning()}'`
        );
        return application.selectFile(hexify.toByteArray('a0000000041010'));
      })
      .then((response) => {
        console.info(
          `Select Application Response: '${response}' '${response.meaning()}'`
        );
        return application.issueCommand(
          new CommandApdu({
            bytes: [0x80, 0xa8, 0x00, 0x00, 0x02, 0x83, 0x00, 0x00],
          })
        );
      })
      .then((response) => {
        console.info(
          `Get Processing Options Response: '${response}' '${response.meaning()}'`
        );
        return response;
      })
      .catch((error) => {
        console.error('Error:', error, error.stack);
      });
  });
  device.on('card-removed', (event) => {
    console.log(`Card ${event.card} removed from '${event.name}' `);
  });
});

devices.on('device-deactivated', (event) => {
  console.log(
    `Device '${event.device}' deactivated, devices: [${event.devices}]`
  );
});
