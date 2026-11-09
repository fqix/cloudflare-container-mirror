import { sourceInfo, statuses } from '../data/registries';
import { Badge } from './ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

export function RegistryTable() {
  return (
    <Card aria-labelledby="sources-title" className="min-w-0">
      <CardHeader>
        <CardTitle id="sources-title" className="text-lg">镜像源</CardTitle>
        <CardDescription>已验证表示完成样本拉取。接口已验证表示清单和分段下载通过。各源仍受上游可用性和限额影响。</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">镜像源</TableHead>
              <TableHead scope="col" className="text-right">验证状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody id="sources">
            {sourceInfo.map(source => (
              <TableRow key={source.host}>
                <TableHead scope="row" className="h-auto whitespace-normal py-2">
                  <code className="font-mono text-xs break-all" title={source.label}>{source.host}</code>
                  <span className="block text-xs font-normal whitespace-normal text-muted-foreground">{source.detail}</span>
                </TableHead>
                <TableCell className="text-right">
                  <Badge variant={source.state === 'verified' ? 'default' : source.state === 'api-verified' ? 'outline' : 'secondary'}>
                    {statuses[source.state]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
