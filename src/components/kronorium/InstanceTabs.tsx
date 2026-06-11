import { Tabs, Tab } from 'fumadocs-ui/components/tabs';
import { instances } from '@/lib/instances';

export function InstanceTabs() {
  return (
    <Tabs items={instances.map((i) => i.name)}>
      {instances.map((instance) => {
        return (
          <Tab key={instance.id} value={instance.name}>
            <h3 className="mt-0 flex items-center gap-2">
              {instance.name}
            </h3>

            {instance.hostedBy && (
              <p>
                Hosted by{' '}
                {instance.hostedByUrl ? (
                  <a href={instance.hostedByUrl} target="_blank" rel="noopener noreferrer" className="text-fd-primary hover:underline">{instance.hostedBy}</a>
                ) : (
                  instance.hostedBy
                )}
                .
              </p>
            )}

            {instance.description && <p className="text-fd-muted-foreground">{instance.description}</p>}

            {instance.warning && (
              <div className="flex gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/10 my-6">
                {instance.warning}
              </div>
            )}

            <table className="w-full mt-4">
              <thead>
                <tr>
                  <th className="text-left pb-2">URL</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <a 
                      href={instance.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-fd-primary hover:underline"
                    >
                      {instance.url.replace('https://', '')}
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </Tab>
        );
      })}
    </Tabs>
  );
}
