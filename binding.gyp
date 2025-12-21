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
    }]
}
