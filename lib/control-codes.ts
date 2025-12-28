/**
 * Control codes and feature constants for PC/SC smart card operations
 */

/**
 * Generate a control code (platform-specific)
 */
export function SCARD_CTL_CODE(code: number): number {
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
export const CM_IOCTL_GET_FEATURE_REQUEST = SCARD_CTL_CODE(3400);

// CCID Feature tags (from CCID spec)
export const FEATURE_VERIFY_PIN_START = 0x01;
export const FEATURE_VERIFY_PIN_FINISH = 0x02;
export const FEATURE_MODIFY_PIN_START = 0x03;
export const FEATURE_MODIFY_PIN_FINISH = 0x04;
export const FEATURE_GET_KEY_PRESSED = 0x05;
export const FEATURE_VERIFY_PIN_DIRECT = 0x06;
export const FEATURE_MODIFY_PIN_DIRECT = 0x07;
export const FEATURE_MCT_READER_DIRECT = 0x08;
export const FEATURE_MCT_UNIVERSAL = 0x09;
export const FEATURE_IFD_PIN_PROPERTIES = 0x0a;
export const FEATURE_ABORT = 0x0b;
export const FEATURE_SET_SPE_MESSAGE = 0x0c;
export const FEATURE_VERIFY_PIN_DIRECT_APP_ID = 0x0d;
export const FEATURE_MODIFY_PIN_DIRECT_APP_ID = 0x0e;
export const FEATURE_WRITE_DISPLAY = 0x0f;
export const FEATURE_GET_KEY = 0x10;
export const FEATURE_IFD_DISPLAY_PROPERTIES = 0x11;
export const FEATURE_GET_TLV_PROPERTIES = 0x12;
export const FEATURE_CCID_ESC_COMMAND = 0x13;

/**
 * Parse feature TLV response from CM_IOCTL_GET_FEATURE_REQUEST
 */
export function parseFeatures(response: Buffer): Map<number, number> {
    const features = new Map<number, number>();
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
