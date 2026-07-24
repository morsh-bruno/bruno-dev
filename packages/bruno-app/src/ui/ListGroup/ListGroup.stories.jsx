import React, { useState } from 'react';
import {
  IconUser,
  IconUsers,
  IconBox,
  IconWorld,
  IconFolder,
  IconBell,
  IconTag,
  IconHome,
  IconSettings,
  IconTrash,
  IconPlus
} from '@tabler/icons';
import ActionIcon from 'ui/ActionIcon';
import ToggleSwitch from 'components/ToggleSwitch';
import ListGroup from './index';

// Options for the Playground's leading-icon control: dropdown label -> icon component.
// The control passes the label string through args; render() resolves it to a component.
const LEADING_ICONS = {
  Users: IconUsers,
  Box: IconBox,
  World: IconWorld,
  Folder: IconFolder,
  Tag: IconTag,
  Home: IconHome,
  Settings: IconSettings
};
const LEADING_ICON_OPTIONS = [...Object.keys(LEADING_ICONS), 'None'];

export default {
  title: 'Components/ListGroup',
  component: ListGroup,
  parameters: {
    layout: 'fullscreen'
  },
  tags: ['autodocs'],
  argTypes: {
    items: { table: { disable: true } },
    className: { table: { disable: true } },
    maxWidth: {
      control: 'number',
      description: 'Width cap for the list/empty frame; a number is treated as px'
    },
    renderItem: {
      control: false,
      description: 'Render prop — return a `<ListGroup.Item>` for each item. This is where the caller supplies its own row markup (leading, body, actions).',
      table: { type: { summary: '(item, index) => ReactNode' }, category: 'Render props' }
    },
    getKey: {
      control: false,
      description: 'Derives a stable React key for each row; defaults to the array index.',
      table: { type: { summary: '(item, index) => string | number' }, category: 'Render props' }
    },
    showEmpty: {
      control: 'boolean',
      description: 'Playground only — render the empty state instead of the sample rows',
      table: { category: 'Playground' }
    },
    emptyTitle: {
      control: 'text',
      description: 'Playground only — emptyState.title',
      table: { category: 'Playground' }
    },
    emptyText: {
      control: 'text',
      description: 'Playground only — emptyState.text',
      table: { category: 'Playground' }
    },
    addButtonLabel: {
      control: 'text',
      description: 'Playground only — addButton.label',
      table: { category: 'Playground' }
    },
    leadingIcon: {
      control: 'select',
      options: LEADING_ICON_OPTIONS,
      description: 'Playground only — leading icon rendered at the start of each row',
      table: { category: 'Playground' }
    }
  }
};

const SAMPLE_MEMBERS = [
  { name: 'Alice Johnson', email: 'alice@example.com' },
  { name: 'Bruno Costa', email: 'bruno@example.com' },
  { name: 'Chen Wei', email: 'chen@example.com' }
];

const MemberRowBody = ({ member }) => (
  <>
    <div style={{ fontSize: '13px', fontWeight: 500 }}>{member.name}</div>
    <div style={{ fontSize: '12px', opacity: 0.6 }}>{member.email}</div>
  </>
);

export const Playground = {
  args: {
    maxWidth: 800,
    showEmpty: false,
    emptyTitle: 'No members yet',
    emptyText: 'Members you add here will appear in this list.',
    addButtonLabel: 'Add Member',
    leadingIcon: 'Users'
  },
  render: ({ maxWidth, showEmpty, emptyTitle, emptyText, addButtonLabel, leadingIcon }) => {
    const LeadingIcon = LEADING_ICONS[leadingIcon];
    return (
      <ListGroup
        maxWidth={maxWidth}
        items={showEmpty ? [] : SAMPLE_MEMBERS}
        getKey={(_, index) => `member-${index}`}
        emptyState={{
          icon: <LeadingIcon size={24} strokeWidth={1.2} />,
          title: emptyTitle,
          text: emptyText
        }}
        addButton={{
          label: addButtonLabel,
          onClick: () => {},
          icon: <IconPlus size={15} strokeWidth={1.5} />
        }}
        renderItem={(member) => (
          <ListGroup.Item leading={LeadingIcon ? <LeadingIcon size={20} strokeWidth={1.5} /> : null}>
            <MemberRowBody member={member} />
          </ListGroup.Item>
        )}
      />
    );
  }
};

export const Default = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ListGroup
      items={SAMPLE_MEMBERS}
      getKey={(_, index) => `member-${index}`}
      renderItem={(member) => (
        <ListGroup.Item leading={<IconUser size={20} strokeWidth={1.5} />}>
          <MemberRowBody member={member} />
        </ListGroup.Item>
      )}
    />
  )
};

export const EmptyState = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ListGroup
      items={[]}
      renderItem={() => null}
      emptyState={{
        icon: <IconUsers size={24} strokeWidth={1.2} />,
        title: 'No members yet',
        text: 'Members you add here will appear in this list.'
      }}
      addButton={{
        label: 'Add Member',
        onClick: () => {},
        icon: <IconPlus size={15} strokeWidth={1.5} />
      }}
    />
  )
};

export const WithAddButton = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ListGroup
      items={SAMPLE_MEMBERS}
      getKey={(_, index) => `member-${index}`}
      addButton={{
        label: 'Add Member',
        onClick: () => {},
        icon: <IconPlus size={15} strokeWidth={1.5} />
      }}
      renderItem={(member) => (
        <ListGroup.Item leading={<IconUser size={20} strokeWidth={1.5} />}>
          <MemberRowBody member={member} />
        </ListGroup.Item>
      )}
    />
  )
};

/**
 * Actions live in the trailing slot and stay hidden until the row is hovered or focused
 * (except controls tagged `stay-visible`). Hover a row to reveal the delete button.
 */
export const WithActions = {
  parameters: { controls: { disable: true } },
  render: () => {
    const RowsWithActions = () => {
      const [disabled, setDisabled] = useState({});
      return (
        <ListGroup
          items={SAMPLE_MEMBERS}
          getKey={(_, index) => `member-${index}`}
          renderItem={(member, index) => (
            <ListGroup.Item
              disabled={disabled[index]}
              leading={<IconUser size={20} strokeWidth={1.5} />}
              actions={(
                <>
                  <ToggleSwitch
                    size="2xs"
                    isOn={!disabled[index]}
                    handleToggle={() => setDisabled((prev) => ({ ...prev, [index]: !prev[index] }))}
                  />
                  <ActionIcon label="Remove" onClick={() => {}}>
                    <IconTrash size={16} strokeWidth={1.5} />
                  </ActionIcon>
                </>
              )}
            >
              <MemberRowBody member={member} />
            </ListGroup.Item>
          )}
        />
      );
    };
    return <RowsWithActions />;
  }
};

export const DisabledItem = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ListGroup
      items={SAMPLE_MEMBERS}
      getKey={(_, index) => `member-${index}`}
      renderItem={(member, index) => (
        <ListGroup.Item
          disabled={index === 1}
          leading={<IconUser size={20} strokeWidth={1.5} />}
          actions={(
            <ToggleSwitch size="2xs" isOn={index !== 1} handleToggle={() => {}} />
          )}
        >
          <MemberRowBody member={member} />
        </ListGroup.Item>
      )}
    />
  )
};
