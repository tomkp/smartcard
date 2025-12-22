// @ts-check
'use strict';

/**
 * Control codes and feature constants for PC/SC smart card operations
 */

/**
 * Generate a control code (platform-specific)
 * @param {number} code - The control code number
 * @returns {number} The platform-specific control code
 */
function SCARD_CTL_CODE(code) {
    if (process.platform === 'win32') {
        // Windows: (FILE_DEVICE_SMARTCARD << 16) + (code << 2)
        // FILE_DEVICE_SMARTCARD = 0x31
        return (0x31 << 16) + (code << 2);
    } else {
        // macOS/Linux: 0x42000000 + code
        return 0x42000000 + code;
    }
}

// Common control codes
const CM_IOCTL_GET_FEATURE_REQUEST = SCARD_CTL_CODE(3400);

// CCID Feature tags (from CCID spec)
const FEATURE_VERIFY_PIN_START = 0x01;
const FEATURE_VERIFY_PIN_FINISH = 0x02;
const FEATURE_MODIFY_PIN_START = 0x03;
const FEATURE_MODIFY_PIN_FINISH = 0x04;
const FEATURE_GET_KEY_PRESSED = 0x05;
const FEATURE_VERIFY_PIN_DIRECT = 0x06;
const FEATURE_MODIFY_PIN_DIRECT = 0x07;
const FEATURE_MCT_READER_DIRECT = 0x08;
const FEATURE_MCT_UNIVERSAL = 0x09;
const FEATURE_IFD_PIN_PROPERTIES = 0x0A;
const FEATURE_ABORT = 0x0B;
const FEATURE_SET_SPE_MESSAGE = 0x0C;
const FEATURE_VERIFY_PIN_DIRECT_APP_ID = 0x0D;
const FEATURE_MODIFY_PIN_DIRECT_APP_ID = 0x0E;
const FEATURE_WRITE_DISPLAY = 0x0F;
const FEATURE_GET_KEY = 0x10;
const FEATURE_IFD_DISPLAY_PROPERTIES = 0x11;
const FEATURE_GET_TLV_PROPERTIES = 0x12;
const FEATURE_CCID_ESC_COMMAND = 0x13;

/**
 * Parse feature TLV response from CM_IOCTL_GET_FEATURE_REQUEST
 * @param {Buffer} response - The TLV response buffer
 * @returns {Map<number, number>} Map of feature tag to control code
 */
function parseFeatures(response) {
    const features = new Map();
    let offset = 0;

    while (offset + 4 <= response.length) {
        const tag = response[offset];
        const length = response[offset + 1];

        if (length === 4 && offset + 2 + length <= response.length) {
            // Big-endian control code
            const controlCode =
                (response[offset + 2] << 24) |
                (response[offset + 3] << 16) |
                (response[offset + 4] << 8) |
                response[offset + 5];
            features.set(tag, controlCode);
        }

        offset += 2 + length;
    }

    return features;
}

module.exports = {
    // Control code generator
    SCARD_CTL_CODE,

    // Common control codes
    CM_IOCTL_GET_FEATURE_REQUEST,

    // CCID Feature tags
    FEATURE_VERIFY_PIN_START,
    FEATURE_VERIFY_PIN_FINISH,
    FEATURE_MODIFY_PIN_START,
    FEATURE_MODIFY_PIN_FINISH,
    FEATURE_GET_KEY_PRESSED,
    FEATURE_VERIFY_PIN_DIRECT,
    FEATURE_MODIFY_PIN_DIRECT,
    FEATURE_MCT_READER_DIRECT,
    FEATURE_MCT_UNIVERSAL,
    FEATURE_IFD_PIN_PROPERTIES,
    FEATURE_ABORT,
    FEATURE_SET_SPE_MESSAGE,
    FEATURE_VERIFY_PIN_DIRECT_APP_ID,
    FEATURE_MODIFY_PIN_DIRECT_APP_ID,
    FEATURE_WRITE_DISPLAY,
    FEATURE_GET_KEY,
    FEATURE_IFD_DISPLAY_PROPERTIES,
    FEATURE_GET_TLV_PROPERTIES,
    FEATURE_CCID_ESC_COMMAND,

    // Helper functions
    parseFeatures,
};
