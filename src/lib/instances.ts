export interface Instance {
  id: string;
  name: string;
  hostedBy?: string;
  hostedByUrl?: string;
  description?: string;
  warning?: string;
  url: string;
}

export const instances: Instance[] = [
  {
    id: 'elfhosted',
    name: 'Elfhosted',
    hostedBy: 'Elfhosted',
    hostedByUrl: 'https://elfhosted.com',
    description: 'Hosted by ElfHosted, a well-known and reputable addon hosting service. The most stable option due to being a professional service. A private instance is available for a monthly fee.',
    url: 'https://aiomanager.elfhosted.com',
  },
  {
    id: 'midnight',
    name: "Midnight's",
    hostedBy: '@midnightignite',
    hostedByUrl: 'https://addonsfortheweebs.midnightignite.me/addons',
    description: 'Hosted by the TorBox community manager.',
    url: 'https://aiomanagerfortheweebs.midnightignite.me',
  },
  {
    id: 'yeb',
    name: "Yeb's",
    hostedBy: '@nhyyeb',
    hostedByUrl: 'https://fortheweak.cloud',
    description: 'Hosted by an AIOManager community member.',
    url: 'https://aiomanager.fortheweak.cloud',
  },
  {
    id: 'kuu',
    name: "Kuu's",
    url: 'https://aiomanager.stremio.ru',
  },
];

