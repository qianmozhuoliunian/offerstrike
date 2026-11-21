"""Collect installed package notices for the self-contained desktop distribution."""
from importlib.metadata import distributions
from pathlib import Path
import re
import shutil
import sys


def main():
    target = Path(sys.argv[1]) / 'licenses'
    target.mkdir(parents=True, exist_ok=True)
    index = ['Python backend dependency notices', 'Build environment packages are included for completeness.', '']
    for distribution in sorted(distributions(), key=lambda item: item.metadata['Name'].lower()):
        name = distribution.metadata['Name']
        index.append(f'{name} {distribution.version}')
        index.extend(distribution.metadata.get_all('Project-URL') or [])
        safe_name = re.sub(r'[^A-Za-z0-9_.-]', '_', name)
        for item in distribution.files or []:
            if '.dist-info/' not in str(item).replace('\\', '/'):
                continue
            if not any(word in str(item).lower() for word in ('license', 'copying', 'notice')):
                continue
            source = Path(distribution.locate_file(item))
            if source.is_file():
                directory = target / safe_name
                directory.mkdir(exist_ok=True)
                shutil.copyfile(source, directory / source.name)
        index.append('')
    license_file = Path(sys.base_prefix) / 'LICENSE.txt'
    if license_file.is_file():
        shutil.copyfile(license_file, target / 'Python-LICENSE.txt')
    (target / 'INDEX.txt').write_text('\n'.join(index), encoding='utf-8')


if __name__ == '__main__':
    main()
