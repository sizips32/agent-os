"""Source-only, unregistered coordination contract. No live CLI or publication."""
import argparse,ast,json
from pathlib import Path
HOME=Path.home()
def runtime_contract(root=None):
 root=Path(root) if root is not None else HOME/'.hermes/hermes-agent'
 facade_tree=ast.parse((root/'run_agent.py').read_text())
 cls=next(n for n in facade_tree.body if isinstance(n,ast.ClassDef) and n.name=='AIAgent')
 facade=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='__init__')
 init_tree=ast.parse((root/'agent/agent_init.py').read_text())
 init=next(n for n in init_tree.body if isinstance(n,ast.FunctionDef) and n.name=='init_agent')
 names=lambda f:{a.arg for a in f.args.posonlyargs+f.args.args+f.args.kwonlyargs}
 left=names(facade)-{'self','tool_delay'};right=names(init)-{'agent'}
 result={'disk_compatible':left==right,'facade_only':sorted(left-right),'initializer_only':sorted(right-left),'running_process_modules':'not inspected; existing controllers may still require an approved restart'}
 if left!=right:raise ValueError('mixed_runtime_constructor_contract: '+json.dumps(result))
 return result

def save(*_args,**_kwargs):
    raise PermissionError('live_publication_review_and_activation_required')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action')
    args,_=parser.parse_known_args()
    if args.action!='doctor':raise PermissionError('candidate_live_execution_and_publication_disabled')
    print(json.dumps(runtime_contract()))

if __name__=='__main__':main()
