import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';

interface RenameDialogProps {
  isOpen: boolean;
  currentTitle: string;
  onClose: () => void;
  onRename: (newTitle: string) => void;
}

const RenameDialog: React.FC<RenameDialogProps> = ({
  isOpen,
  currentTitle,
  onClose,
  onRename
}) => {
  const [title, setTitle] = useState(currentTitle);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim()) {
      onRename(title);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Rename Recording</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full"
            placeholder="Enter new title"
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RenameDialog;