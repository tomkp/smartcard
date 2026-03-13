{
    "targets": [{
        "target_name": "smartcard_napi",
        "cflags!": ["-fno-exceptions"],
        "cflags_cc!": ["-fno-exceptions"],
        "sources": [
            "src/addon.cpp",
            "src/pcsc_context.cpp",
            "src/pcsc_reader.cpp",
            "src/pcsc_card.cpp",
            "src/async_workers.cpp",
            "src/reader_monitor.cpp"
        ],
        "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include\")"
        ],
        "defines": [
            "NAPI_VERSION=8",
            "NAPI_CPP_EXCEPTIONS"
        ],
        "conditions": [
            ["OS=='win'", {
                "libraries": ["-lwinscard"],
                "msvs_settings": {
                    "VCCLCompilerTool": {
                        "ExceptionHandling": 1
                    }
                }
            }],
            ["OS=='mac'", {
                "libraries": ["-framework PCSC"],
                "xcode_settings": {
                    "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
                    "CLANG_CXX_LIBRARY": "libc++",
                    "MACOSX_DEPLOYMENT_TARGET": "10.15"
                }
            }],
            ["OS=='linux'", {
                "libraries": ["-lpcsclite"],
                "include_dirs": ["/usr/include/PCSC"],
                "cflags_cc": ["-fexceptions"]
            }]
        ]
    },
    {
        "target_name": "smartcard_tests",
        "type": "executable",
        "sources": [
            "src/test/test_main.cpp",
            "src/test/reader_state_utils_test.cpp"
        ],
        "include_dirs": [
            "src",
            "src/test"
        ],
        "cflags_cc!": ["-fno-exceptions"],
        "conditions": [
            ["OS=='mac'", {
                "xcode_settings": {
                    "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
                    "CLANG_CXX_LANGUAGE_STANDARD": "c++17"
                }
            }],
            ["OS=='linux'", {
                "cflags_cc": ["-std=c++17", "-fexceptions"]
            }],
            ["OS=='win'", {
                "msvs_settings": {
                    "VCCLCompilerTool": {
                        "ExceptionHandling": 1,
                        "AdditionalOptions": ["/std:c++17"]
                    }
                }
            }]
        ]
    }]
}
