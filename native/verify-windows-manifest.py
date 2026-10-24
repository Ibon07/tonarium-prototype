#!/usr/bin/env python3
"""Verify the actual Windows apphost's activation manifest (requires pefile)."""
import sys
import xml.etree.ElementTree as ET
import pefile


def verify(filename):
    with pefile.PE(filename, fast_load=True) as pe:
        pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_RESOURCE']])
        resources = getattr(pe, 'DIRECTORY_ENTRY_RESOURCE', None)
        for kind in resources.entries if resources else []:
            if kind.id != 24:  # RT_MANIFEST
                continue
            for resource in kind.directory.entries:
                if resource.id != 1:  # CREATEPROCESS_MANIFEST_RESOURCE_ID
                    continue
                for language in resource.directory.entries:
                    entry = language.data.struct
                    manifest = ET.fromstring(pe.get_data(entry.OffsetToData, entry.Size).rstrip(b'\0'))
                    supported = manifest.findall('.//{urn:schemas-microsoft-com:compatibility.v1}supportedOS')
                    if not any(node.get('Id', '').lower() == '{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}' for node in supported):
                        raise ValueError(f'{filename}: Windows 10/11 supportedOS declaration missing')
                    dpi = manifest.find('.//{http://schemas.microsoft.com/SMI/2016/WindowsSettings}dpiAwareness')
                    if dpi is None or dpi.text != 'PerMonitorV2':
                        raise ValueError(f'{filename}: PerMonitorV2 declaration missing')
                    print(f'{filename}: embedded Windows compatibility and DPI manifest verified')
                    return
    raise ValueError(f'{filename}: activation manifest (RT_MANIFEST/1) missing')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: verify-windows-manifest.py <app.exe>')
    try:
        verify(sys.argv[1])
    except (ValueError, pefile.PEFormatError, ET.ParseError) as error:
        raise SystemExit(str(error)) from error
